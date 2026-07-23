import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound } from '../../lib/errors';
import { sendStoredFile } from '../../lib/upload';
import { fulfilShopOrder } from './shopFulfil';

// The Principal's side of the JuanPalaman shop — a DMS (sales & distribution)
// feature, not a marketing one: read the orders that came in and move them
// through fulfilment. Principal-only.
export const shopOrdersRouter = Router();
shopOrdersRouter.use(authenticate);
shopOrdersRouter.use(requireRole('PRINCIPAL'));
shopOrdersRouter.use(requirePermission('sales'));

const STATUSES = ['PENDING', 'CONFIRMED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// GET /marketing/shop-orders — the order queue with a revenue summary.
shopOrdersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const orders = await prisma.shopOrder.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });

    const counts = await prisma.shopOrder.groupBy({ by: ['status'], _count: true });
    const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
    // Revenue only counts orders that were not cancelled.
    const live = orders.filter((o) => o.status !== 'CANCELLED');

    res.json({
      orders: orders.map((o) => ({
        id: o.id,
        code: o.code,
        name: o.name,
        phone: o.phone,
        email: o.email,
        address: o.address,
        landmark: o.landmark,
        customerType: o.customerType,
        paymentMethod: o.paymentMethod,
        status: o.status,
        note: o.note,
        total: o.total,
        hasProof: !!o.proofData,
        saleId: o.saleId,
        createdAt: o.createdAt,
        items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
      })),
      summary: {
        total: counts.reduce((n, c) => n + c._count, 0),
        pending: count('PENDING'),
        confirmed: count('CONFIRMED') + count('PAID'),
        shipped: count('SHIPPED'),
        delivered: count('DELIVERED'),
        cancelled: count('CANCELLED'),
        revenue: round2(live.reduce((s, o) => s + o.total, 0)),
        repeatShare: live.length
          ? Math.round((live.filter((o) => o.customerType === 'REPEAT').length / live.length) * 100)
          : 0,
      },
    });
  })
);

const patchSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().max(500).nullable().optional(),
});

// PATCH /marketing/shop-orders/:id — move an order along.
shopOrdersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.shopOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Order not found');
    const b = patchSchema.parse(req.body);
    const order = await prisma.shopOrder.update({
      where: { id: existing.id },
      data: { status: b.status, note: b.note ?? existing.note },
    });

    // Delivery is the point of no return: book it into the DMS as a real sale —
    // stock deducted, customer created, revenue posted, sales report updated —
    // exactly once. Best-effort so a bookkeeping hiccup never blocks the status
    // change the operator just made.
    if (b.status === 'DELIVERED' && !existing.saleId) {
      await fulfilShopOrder(order.id, req.auth!.orgId, req.auth!.sub).catch((e) =>
        console.error('[shop] fulfil failed', e?.message)
      );
    }

    res.json({ id: order.id, status: order.status });
  })
);

// GET /marketing/shop-orders/:id/proof — the buyer's proof of payment.
shopOrdersRouter.get(
  '/:id/proof',
  asyncHandler(async (req, res) => {
    const o = await prisma.shopOrder.findUnique({ where: { id: req.params.id } });
    if (!o || !o.proofData) throw notFound('No proof of payment on this order');
    sendStoredFile(res, { data: o.proofData, fileName: o.proofName ?? 'proof', mimeType: o.proofMimeType ?? 'application/octet-stream' }, 'inline');
  })
);

// DELETE /marketing/shop-orders/:id — remove a junk or test order.
shopOrdersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.shopOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Order not found');
    await prisma.shopOrder.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);
