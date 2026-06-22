import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { badRequest, forbidden, notFound, conflict } from '../../lib/errors';
import { priceLines } from '../../lib/pricing';
import { poNumber, saleNumber } from '../../lib/numbering';
import { applyStockMovement } from '../inventory/inventory.service';
import { sendPoSubmittedEmail } from '../../lib/email';

export const poRouter = Router();
poRouter.use(authenticate);

// Org fields exposed on a PO so documents (e.g. PDF) can show full party details.
const orgSelect = {
  id: true,
  name: true,
  type: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  address: true,
} as const;

const createSchema = z.object({
  distributionType: z.enum(['TRADE', 'DROP_SHIP']).default('TRADE'),
  expectedDeliveryDate: z.coerce.date().optional(),
  // Drop-ship delivery details (required when distributionType is DROP_SHIP).
  recipientName: z.string().optional(),
  recipientAddress: z.string().optional(),
  recipientPhone: z.string().optional(),
  landmark: z.string().optional(),
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

    // Optional order-date range filter.
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (req.query.from) createdAt.gte = new Date(req.query.from as string);
    if (req.query.to) {
      const end = new Date(req.query.to as string);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    const dateFilter = createdAt.gte || createdAt.lte ? { createdAt } : {};

    const orders = await prisma.purchaseOrder.findMany({
      where: {
        AND: [
          { OR: [{ buyerOrgId: { in: scope } }, { sellerOrgId: { in: scope } }] },
          status ? { status: status as any } : {},
          dateFilter,
        ],
      },
      include: {
        buyerOrg: { select: orgSelect },
        sellerOrg: { select: orgSelect },
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

    // Drop-ship orders are shipped directly to an end recipient, so capture
    // the delivery details the Principal will need.
    if (body.distributionType === 'DROP_SHIP') {
      if (!body.recipientName || !body.recipientAddress || !body.recipientPhone) {
        throw badRequest(
          'Drop-ship orders require recipient name, complete address, and cellphone number'
        );
      }
    }

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
        expectedDeliveryDate: body.expectedDeliveryDate ?? null,
        recipientName: body.distributionType === 'DROP_SHIP' ? body.recipientName : null,
        recipientAddress: body.distributionType === 'DROP_SHIP' ? body.recipientAddress : null,
        recipientPhone: body.distributionType === 'DROP_SHIP' ? body.recipientPhone : null,
        landmark: body.distributionType === 'DROP_SHIP' ? body.landmark ?? null : null,
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

    // Notify the supplier (the tier directly above) by email — best effort,
    // never blocks the submission.
    let notification: { sent: boolean; reason?: string } = { sent: false };
    try {
      const seller = await prisma.organization.findUnique({
        where: { id: po.sellerOrgId },
        include: { users: { take: 1, orderBy: { createdAt: 'asc' }, select: { email: true } } },
      });
      const to = seller?.contactEmail || seller?.users[0]?.email || '';
      notification = await sendPoSubmittedEmail({
        to,
        supplierName: po.sellerOrg.name,
        poNumber: po.number,
        buyerName: po.buyerOrg.name,
        total: po.total,
        distributionType: po.distributionType,
        itemsCount: po.items.length,
      });
    } catch (err) {
      console.error('[po.submit] notification failed', err);
    }

    res.json({ ...updated, notification });
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

// Buyer records actual quantities received (supports partial receipts).
// Body: { items: [{ itemId, received }] } where `received` is the quantity
// received in THIS event. Trade -> increases buyer inventory by that amount;
// Drop-ship -> no inventory change but receipts are still tracked.
// Status becomes PARTIALLY_RECEIVED, then RECEIVED once every line is complete.
const receiveSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string(), received: z.number().int().min(0) }))
    .min(1),
});

poRouter.post(
  '/:id/receive',
  asyncHandler(async (req, res) => {
    const body = receiveSchema.parse(req.body);
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    if (po.status !== 'FULFILLED' && po.status !== 'PARTIALLY_RECEIVED') {
      throw conflict(`Cannot receive a PO in status ${po.status}`);
    }

    const itemById = new Map(po.items.map((i) => [i.id, i]));
    // Validate every line up front.
    for (const r of body.items) {
      const item = itemById.get(r.itemId);
      if (!item) throw badRequest(`Unknown PO item ${r.itemId}`);
      const newTotal = item.receivedQuantity + r.received;
      if (newTotal > item.quantity) {
        throw badRequest(
          `Received (${newTotal}) exceeds ordered (${item.quantity}) for ${item.product.name}`
        );
      }
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        for (const r of body.items) {
          if (r.received <= 0) continue;
          const item = itemById.get(r.itemId)!;
          if (po.distributionType === 'TRADE') {
            await applyStockMovement(tx, {
              orgId: po.buyerOrgId,
              productId: item.productId,
              change: r.received,
              reason: 'PO_RECEIVED',
              refType: 'PurchaseOrder',
              refId: po.id,
            });
          }
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { receivedQuantity: { increment: r.received } },
          });
        }

        // Recompute completion from fresh totals.
        const items = await tx.purchaseOrderItem.findMany({ where: { poId: po.id } });
        const fullyReceived = items.every((i) => i.receivedQuantity >= i.quantity);
        const anyReceived = items.some((i) => i.receivedQuantity > 0);
        const status = fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status;

        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status, receivedAt: fullyReceived ? new Date() : po.receivedAt },
          include: { items: { include: { product: { select: { sku: true, name: true } } } } },
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

// Cancel (buyer). Allowed any time before completion (RECEIVED). If the PO was
// already fulfilled/partially received, its inventory effects and generated
// sale are reversed so the books stay consistent.
poRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    if (po.status === 'RECEIVED' || po.status === 'CANCELLED') {
      throw conflict(`Cannot cancel a PO in status ${po.status}`);
    }
    const needsReversal = po.status === 'FULFILLED' || po.status === 'PARTIALLY_RECEIVED';

    const updated = await prisma.$transaction(async (tx) => {
      if (needsReversal) {
        if (po.distributionType === 'TRADE') {
          for (const item of po.items) {
            // Return the fulfilled quantity to the seller.
            await applyStockMovement(tx, {
              orgId: po.sellerOrgId,
              productId: item.productId,
              change: item.quantity,
              reason: 'PO_CANCELLED_RESTOCK',
              refType: 'PurchaseOrder',
              refId: po.id,
              allowNegative: true,
            });
            // Remove anything the buyer had already received.
            if (item.receivedQuantity > 0) {
              await applyStockMovement(tx, {
                orgId: po.buyerOrgId,
                productId: item.productId,
                change: -item.receivedQuantity,
                reason: 'PO_CANCELLED_RETURN',
                refType: 'PurchaseOrder',
                refId: po.id,
                allowNegative: true,
              });
            }
          }
        }
        // Void the sale that was generated on fulfillment.
        await tx.saleItem.deleteMany({ where: { sale: { poId: po.id } } });
        await tx.sale.deleteMany({ where: { poId: po.id } });
        await tx.purchaseOrderItem.updateMany({
          where: { poId: po.id },
          data: { receivedQuantity: 0 },
        });
      }

      await tx.approval.updateMany({
        where: { poId: po.id, status: 'PENDING' },
        data: { status: 'REJECTED', note: 'PO cancelled' },
      });
      return tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'CANCELLED' },
      });
    });

    res.json(updated);
  })
);

// Attachments (proof of payment) ---------------------------------------------

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB original (stays under platform body limit)
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];

const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});

// List attachment metadata — visible to anyone in the PO's chain (buyer + supplier).
poRouter.get(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    const attachments = await prisma.poAttachment.findMany({
      where: { poId: po.id },
      select: {
        id: true,
        kind: true,
        fileName: true,
        mimeType: true,
        size: true,
        createdAt: true,
        uploadedBy: { select: { name: true, orgId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ attachments });
  })
);

// Upload proof of payment — only the buyer (customer) may attach.
poRouter.post(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    const body = uploadSchema.parse(req.body);

    if (!ALLOWED_TYPES.includes(body.mimeType.toLowerCase())) {
      throw badRequest('Only images (PNG/JPG/WEBP) or PDF files are allowed');
    }
    const cleaned = body.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const size = Math.floor((cleaned.length * 3) / 4);
    if (size > MAX_UPLOAD_BYTES) throw badRequest('File too large (max 3 MB)');

    const att = await prisma.poAttachment.create({
      data: {
        poId: po.id,
        fileName: body.fileName,
        mimeType: body.mimeType,
        size,
        data: cleaned,
        uploadedById: req.auth!.sub,
      },
    });
    res.status(201).json({ id: att.id, fileName: att.fileName, mimeType: att.mimeType, size: att.size });
  })
);

// Stream an attachment's content — visible to anyone in the PO's chain.
poRouter.get(
  '/:id/attachments/:attId/content',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    const att = await prisma.poAttachment.findFirst({
      where: { id: req.params.attId, poId: po.id },
    });
    if (!att) throw notFound('Attachment not found');
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${att.fileName}"`);
    res.send(Buffer.from(att.data, 'base64'));
  })
);

// Helpers --------------------------------------------------------------------

async function loadScopedPo(req: any, id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { sku: true, name: true } } } },
      buyerOrg: { select: orgSelect },
      sellerOrg: { select: orgSelect },
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
