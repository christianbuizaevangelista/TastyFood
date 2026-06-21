import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { badRequest, forbidden, notFound, conflict } from '../../lib/errors';
import { priceLines } from '../../lib/pricing';
import { poNumber, saleNumber } from '../../lib/numbering';
import { applyStockMovement } from '../inventory/inventory.service';

export const poRouter = Router();
poRouter.use(authenticate);

const createSchema = z.object({
  distributionType: z.enum(['TRADE', 'DROP_SHIP']).default('TRADE'),
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().positive() }))
    .min(1),
});

// GET /purchase-orders — POs where buyer OR seller is in the requester's scope.
poRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.scopeOrgIds!;
    const status = req.query.status as string | undefined;
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        AND: [
          { OR: [{ buyerOrgId: { in: scope } }, { sellerOrgId: { in: scope } }] },
          status ? { status: status as any } : {},
        ],
      },
      include: {
        buyerOrg: { select: { id: true, name: true, type: true } },
        sellerOrg: { select: { id: true, name: true, type: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ orders });
  })
);

poRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    res.json(po);
  })
);

// POST /purchase-orders — buyer drafts a PO against its immediate parent.
poRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const buyer = await prisma.organization.findUnique({ where: { id: req.auth!.orgId } });
    if (!buyer) throw notFound('Organization not found');
    if (buyer.status !== 'APPROVED' || !buyer.isActive) {
      throw forbidden('Your organization must be approved and active to create purchase orders');
    }
    if (!buyer.parentId) throw badRequest('Principal has no upstream supplier to order from');

    const products = await prisma.product.findMany({
      where: { id: { in: body.items.map((i) => i.productId) } },
    });
    if (products.length !== new Set(body.items.map((i) => i.productId)).size) {
      throw badRequest('One or more products were not found');
    }
    const srpById = new Map(products.map((p) => [p.id, p.srp]));

    const priced = priceLines(
      body.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        srp: srpById.get(i.productId)!,
      })),
      buyer.discountRate
    );

    const po = await prisma.purchaseOrder.create({
      data: {
        number: poNumber(),
        buyerOrgId: buyer.id,
        sellerOrgId: buyer.parentId,
        distributionType: body.distributionType,
        status: 'DRAFT',
        discountRate: buyer.discountRate,
        subtotal: priced.subtotal,
        total: priced.total,
        createdById: req.auth!.sub,
        items: { create: priced.items },
      },
      include: { items: true },
    });
    res.status(201).json(po);
  })
);

// Status transitions ---------------------------------------------------------

// Buyer submits a DRAFT for the seller's approval.
poRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    if (po.status !== 'DRAFT') throw conflict(`Cannot submit a PO in status ${po.status}`);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      await tx.approval.create({
        data: {
          type: 'PO_APPROVAL',
          status: 'PENDING',
          orgId: po.buyerOrgId,
          poId: po.id,
          requestedById: req.auth!.sub,
        },
      });
      return u;
    });
    res.json(updated);
  })
);

// Seller (parent) approves a SUBMITTED PO.
poRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireSeller(req, po);
    if (po.status !== 'SUBMITTED') throw conflict(`Cannot approve a PO in status ${po.status}`);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
      await tx.approval.updateMany({
        where: { poId: po.id, type: 'PO_APPROVAL', status: 'PENDING' },
        data: { status: 'APPROVED', decidedById: req.auth!.sub, decidedAt: new Date() },
      });
      return u;
    });
    res.json(updated);
  })
);

// Seller rejects a SUBMITTED PO.
poRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireSeller(req, po);
    if (po.status !== 'SUBMITTED') throw conflict(`Cannot reject a PO in status ${po.status}`);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'CANCELLED' },
      });
      await tx.approval.updateMany({
        where: { poId: po.id, type: 'PO_APPROVAL', status: 'PENDING' },
        data: { status: 'REJECTED', decidedById: req.auth!.sub, decidedAt: new Date(), note: 'Rejected by supplier' },
      });
      return u;
    });
    res.json(updated);
  })
);

// Seller fulfills an APPROVED PO. Trade -> deduct seller inventory + record a
// Sale for the seller. Drop-ship -> still record the Sale, but no stock change.
poRouter.post(
  '/:id/fulfill',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireSeller(req, po);
    if (po.status !== 'APPROVED') throw conflict(`Cannot fulfill a PO in status ${po.status}`);

    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (po.distributionType === 'TRADE') {
          for (const item of po.items) {
            await applyStockMovement(tx, {
              orgId: po.sellerOrgId,
              productId: item.productId,
              change: -item.quantity,
              reason: 'PO_FULFILLED',
              refType: 'PurchaseOrder',
              refId: po.id,
            });
          }
        }
        // Record the seller's sale generated from this PO.
        await tx.sale.create({
          data: {
            number: saleNumber(),
            sellerOrgId: po.sellerOrgId,
            buyerOrgId: po.buyerOrgId,
            channel: 'PO',
            distributionType: po.distributionType,
            discountRate: po.discountRate,
            subtotal: po.subtotal,
            total: po.total,
            poId: po.id,
            createdById: req.auth!.sub,
            items: {
              create: po.items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                unitSrp: i.unitSrp,
                unitPrice: i.unitPrice,
                lineTotal: i.lineTotal,
              })),
            },
          },
        });
        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'FULFILLED', fulfilledAt: new Date() },
        });
      });
      res.json(updated);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.startsWith('Insufficient stock')) {
        throw badRequest(err.message);
      }
      throw err;
    }
  })
);

// Buyer receives a FULFILLED PO. Trade -> increase buyer inventory.
// Drop-ship -> no buyer inventory change (shipped directly upstream).
poRouter.post(
  '/:id/receive',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    if (po.status !== 'FULFILLED') throw conflict(`Cannot receive a PO in status ${po.status}`);

    const updated = await prisma.$transaction(async (tx) => {
      if (po.distributionType === 'TRADE') {
        for (const item of po.items) {
          await applyStockMovement(tx, {
            orgId: po.buyerOrgId,
            productId: item.productId,
            change: item.quantity,
            reason: 'PO_RECEIVED',
            refType: 'PurchaseOrder',
            refId: po.id,
          });
        }
      }
      return tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      });
    });
    res.json(updated);
  })
);

// Cancel (buyer, before fulfillment).
poRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    if (['FULFILLED', 'RECEIVED', 'CANCELLED'].includes(po.status)) {
      throw conflict(`Cannot cancel a PO in status ${po.status}`);
    }
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'CANCELLED' },
    });
    await prisma.approval.updateMany({
      where: { poId: po.id, status: 'PENDING' },
      data: { status: 'REJECTED', note: 'PO cancelled' },
    });
    res.json(updated);
  })
);

// Helpers --------------------------------------------------------------------

async function loadScopedPo(req: any, id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { sku: true, name: true } } } },
      buyerOrg: { select: { id: true, name: true, type: true } },
      sellerOrg: { select: { id: true, name: true, type: true } },
    },
  });
  if (!po) throw notFound('Purchase order not found');
  const scope: string[] = req.scopeOrgIds;
  if (!scope.includes(po.buyerOrgId) && !scope.includes(po.sellerOrgId)) {
    throw forbidden('Purchase order is outside your access scope');
  }
  return po;
}

function requireBuyer(req: any, po: { buyerOrgId: string }) {
  if (req.auth.orgId !== po.buyerOrgId) throw forbidden('Only the buyer can perform this action');
}

function requireSeller(req: any, po: { sellerOrgId: string }) {
  if (req.auth.orgId !== po.sellerOrgId) throw forbidden('Only the seller can perform this action');
}
