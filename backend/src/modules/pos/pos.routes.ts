import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { priceLines } from '../../lib/pricing';
import { saleNumber } from '../../lib/numbering';
import { applyStockMovement } from '../inventory/inventory.service';

export const posRouter = Router();
posRouter.use(authenticate);

const saleSchema = z.object({
  distributionType: z.enum(['TRADE', 'DROP_SHIP']).default('TRADE'),
  customerName: z.string().optional(),
  // Optional known downstream account; its tier discount is applied.
  buyerOrgId: z.string().optional(),
  // Explicit discount override (0..1). Falls back to buyer org's rate, else 0 (SRP).
  discountRate: z.number().min(0).max(1).optional(),
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().positive() }))
    .min(1),
});

// POST /pos/sales — record a direct sale at the requester's org.
posRouter.post(
  '/sales',
  asyncHandler(async (req, res) => {
    const body = saleSchema.parse(req.body);
    const seller = await prisma.organization.findUnique({ where: { id: req.auth!.orgId } });
    if (!seller) throw notFound('Organization not found');
    if (seller.status !== 'APPROVED' || !seller.isActive) {
      throw forbidden('Your organization must be approved and active to record sales');
    }

    // Determine the discount to apply. Selling to a downstream account in your
    // network auto-applies that account's tier discount; walk-in/other = SRP.
    let discountRate = body.discountRate ?? 0;
    if (body.buyerOrgId) {
      const buyer = await prisma.organization.findUnique({ where: { id: body.buyerOrgId } });
      if (!buyer) throw badRequest('Buyer organization not found');
      if (!req.scopeOrgIds!.includes(buyer.id) || buyer.id === seller.id) {
        throw badRequest('You can only sell to accounts within your downstream network');
      }
      discountRate = buyer.discountRate; // tier discount: PROVINCIAL 20%, CITY 15%, RESELLER 8%
    }

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
      discountRate
    );

    try {
      const sale = await prisma.$transaction(async (tx) => {
        // Trade deducts the seller's own inventory; drop-ship does not.
        if (body.distributionType === 'TRADE') {
          for (const item of priced.items) {
            await applyStockMovement(tx, {
              orgId: seller.id,
              productId: item.productId,
              change: -item.quantity,
              reason: 'POS_SALE',
              refType: 'Sale',
            });
          }
        }
        return tx.sale.create({
          data: {
            number: saleNumber(),
            sellerOrgId: seller.id,
            buyerOrgId: body.buyerOrgId,
            channel: 'POS',
            distributionType: body.distributionType,
            customerName: body.customerName,
            discountRate,
            subtotal: priced.subtotal,
            total: priced.total,
            createdById: req.auth!.sub,
            items: { create: priced.items },
          },
          include: {
            items: { include: { product: { select: { sku: true, name: true } } } },
            sellerOrg: { select: { name: true, type: true } },
          },
        });
      });
      res.status(201).json(buildReceipt(sale));
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.startsWith('Insufficient stock')) {
        throw badRequest(err.message);
      }
      throw err;
    }
  })
);

// GET /pos/sales/:id — receipt for a sale within scope.
posRouter.get(
  '/sales/:id',
  asyncHandler(async (req, res) => {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: { select: { sku: true, name: true } } } },
        sellerOrg: { select: { name: true, type: true } },
      },
    });
    if (!sale) throw notFound('Sale not found');
    if (!req.scopeOrgIds!.includes(sale.sellerOrgId)) {
      throw forbidden('Sale is outside your access scope');
    }
    res.json(buildReceipt(sale));
  })
);

function buildReceipt(sale: any) {
  return {
    id: sale.id,
    number: sale.number,
    seller: sale.sellerOrg,
    channel: sale.channel,
    distributionType: sale.distributionType,
    customerName: sale.customerName,
    discountRate: sale.discountRate,
    subtotal: sale.subtotal,
    total: sale.total,
    savings: Math.round((sale.subtotal - sale.total) * 100) / 100,
    createdAt: sale.createdAt,
    lines: sale.items.map((i: any) => ({
      sku: i.product.sku,
      name: i.product.name,
      quantity: i.quantity,
      unitSrp: i.unitSrp,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
  };
}
