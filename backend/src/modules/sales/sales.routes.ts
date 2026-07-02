import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { forbidden, notFound, badRequest } from '../../lib/errors';
import { sendSaleReceiptEmail } from '../../lib/email';
import { applyStockMovement } from '../inventory/inventory.service';
import { postSaleRefundToBooks } from '../accounting/accounting.service';

export const salesRouter = Router();
salesRouter.use(authenticate);
salesRouter.use(requirePermission('sales'));

// Load a sale scoped to the requester (its seller must be in the chain).
async function loadScopedSale(req: any, id: string) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      sellerOrg: { select: { name: true, type: true } },
      buyerOrg: {
        select: {
          name: true,
          contactEmail: true,
          users: { take: 1, orderBy: { createdAt: 'asc' }, select: { email: true } },
        },
      },
      items: { include: { product: { select: { sku: true, name: true } } } },
    },
  });
  if (!sale) throw notFound('Sale not found');
  if (!req.scopeOrgIds.includes(sale.sellerOrgId)) throw forbidden('Sale is outside your access scope');
  return sale;
}

function receiptOf(sale: any, viewerOrgId?: string) {
  const hasRefundable = sale.items.some((i: any) => i.quantity - (i.refundedQuantity ?? 0) > 0);
  return {
    id: sale.id,
    number: sale.number,
    seller: sale.sellerOrg,
    channel: sale.channel,
    distributionType: sale.distributionType,
    customerName: sale.buyerOrg?.name ?? sale.customerName ?? 'Walk-in',
    // Auto-fill from the customer's application: contact email, else admin login email.
    customerEmail: sale.buyerOrg?.contactEmail ?? sale.buyerOrg?.users?.[0]?.email ?? null,
    discountRate: sale.discountRate,
    subtotal: sale.subtotal,
    total: sale.total,
    savings: Math.round((sale.subtotal - sale.total) * 100) / 100,
    createdAt: sale.createdAt,
    // Anyone who can see the sale (it's within their scope) may refund it while
    // quantity remains; the stock is returned to the actual seller's inventory.
    canRefund: !!viewerOrgId && hasRefundable,
    lines: sale.items.map((i: any) => ({
      id: i.id,
      sku: i.product.sku,
      name: i.product.name,
      quantity: i.quantity,
      refundedQuantity: i.refundedQuantity ?? 0,
      refundable: i.quantity - (i.refundedQuantity ?? 0),
      unitSrp: i.unitSrp,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
  };
}

// Build the Prisma where-clause from query filters, always scoped to the
// requester's org chain (downstream rollup happens for upstream roles).
function buildWhere(req: any): Prisma.SaleWhereInput {
  const { from, to, tier, sellerOrgId, productId, distributionType, channel } = req.query;
  const scope: string[] = req.scopeOrgIds;

  const where: Prisma.SaleWhereInput = {
    sellerOrgId: sellerOrgId ? (sellerOrgId as string) : { in: scope },
  };
  // If a specific seller is requested it must still be in scope.
  if (sellerOrgId && !scope.includes(sellerOrgId as string)) {
    where.sellerOrgId = { in: [] }; // nothing
  }

  const createdAt: Prisma.DateTimeFilter = {};
  if (from) createdAt.gte = new Date(from as string);
  if (to) {
    const end = new Date(to as string);
    end.setHours(23, 59, 59, 999);
    createdAt.lte = end;
  }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  if (distributionType) where.distributionType = distributionType as any;
  if (channel) where.channel = channel as any;
  if (tier) where.sellerOrg = { type: tier as any };
  if (productId) where.items = { some: { productId: productId as string } };

  return where;
}

// GET /sales — filterable sales list + aggregate summary.
salesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = buildWhere(req);
    const sales = await prisma.sale.findMany({
      where,
      include: {
        sellerOrg: { select: { id: true, name: true, type: true, discountRate: true } },
        buyerOrg: { select: { id: true, name: true, type: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Cost of goods sold = the units sold × the seller's own inventory unit cost
    // for that product (keyed by seller org + product). Gross income = net sales
    // − COGS. This matches the Dashboard's gross margin basis.
    const sellerOrgIds = [...new Set(sales.map((s) => s.sellerOrgId))];
    const invRows = await prisma.inventory.findMany({
      where: { orgId: { in: sellerOrgIds } },
      select: { orgId: true, productId: true, cost: true },
    });
    const ckey = (orgId: string, productId: string) => `${orgId}:${productId}`;
    const unitCostMap = new Map(invRows.map((r) => [ckey(r.orgId, r.productId), r.cost ?? 0]));

    // Units still counted (refunded units are excluded — they are returned).
    const netQty = (it: (typeof sales)[number]['items'][number]) => it.quantity - (it.refundedQuantity ?? 0);

    // Per-line COGS: net (non-refunded) qty × the seller's inventory unit cost.
    const itemCost = (s: (typeof sales)[number], it: (typeof sales)[number]['items'][number]) =>
      netQty(it) * (unitCostMap.get(ckey(s.sellerOrgId, it.productId)) ?? 0);

    // Per-sale COGS = sum of its line costs.
    const sellerCost = (s: (typeof sales)[number]) =>
      s.items.reduce((c, it) => c + itemCost(s, it), 0);

    // Per-SKU aggregation (revenue + gross profit).
    const skuMap = new Map<string, { sku: string; name: string; units: number; revenue: number; cost: number }>();
    for (const s of sales) {
      for (const it of s.items) {
        const key = it.product.sku;
        const row = skuMap.get(key) ?? { sku: it.product.sku, name: it.product.name, units: 0, revenue: 0, cost: 0 };
        row.units += netQty(it);
        row.revenue += it.unitPrice * netQty(it);
        row.cost += itemCost(s, it);
        skuMap.set(key, row);
      }
    }
    const bySku = [...skuMap.values()]
      .map((r) => ({ sku: r.sku, name: r.name, units: r.units, revenue: round2(r.revenue), grossProfit: round2(r.revenue - r.cost) }))
      .sort((a, b) => b.revenue - a.revenue);

    // Per-channel aggregation (revenue + gross profit).
    const channelAgg = (ch: 'PO' | 'POS') => {
      const list = sales.filter((s) => s.channel === ch);
      return {
        count: list.length,
        units: list.reduce((u, x) => u + x.items.reduce((q, i) => q + netQty(i), 0), 0),
        revenue: round2(list.reduce((s, x) => s + x.total, 0)),
        grossProfit: round2(list.reduce((g, x) => g + (x.total - sellerCost(x)), 0)),
      };
    };

    const summary = {
      count: sales.length,
      revenue: round2(sales.reduce((s, x) => s + x.total, 0)),
      // Gross income = net sales minus cost of goods sold (both exclude refunds).
      grossIncome: round2(sales.reduce((g, x) => g + (x.total - sellerCost(x)), 0)),
      units: sales.reduce((s, x) => s + x.items.reduce((u, i) => u + netQty(i), 0), 0),
      // "Distribution" = trade (stock moves down the chain); kept key name `trade`.
      trade: {
        count: sales.filter((s) => s.distributionType === 'TRADE').length,
        revenue: round2(
          sales.filter((s) => s.distributionType === 'TRADE').reduce((s, x) => s + x.total, 0)
        ),
      },
      dropShip: {
        count: sales.filter((s) => s.distributionType === 'DROP_SHIP').length,
        revenue: round2(
          sales.filter((s) => s.distributionType === 'DROP_SHIP').reduce((s, x) => s + x.total, 0)
        ),
      },
      byChannel: { PO: channelAgg('PO'), POS: channelAgg('POS') },
      bySku,
    };

    // Per-sale gross profit + refund status ('NONE' | 'PARTIAL' | 'FULL') for the list.
    const salesWithProfit = sales.map((s) => {
      const soldQty = s.items.reduce((q, i) => q + i.quantity, 0);
      const refundedQty = s.items.reduce((q, i) => q + (i.refundedQuantity ?? 0), 0);
      const refundStatus = refundedQty <= 0 ? 'NONE' : refundedQty >= soldQty ? 'FULL' : 'PARTIAL';
      return { ...s, grossProfit: round2(s.total - sellerCost(s)), refundedQty, refundStatus };
    });

    res.json({ summary, sales: salesWithProfit });
  })
);

// GET /sales/export.csv — same filters, streamed as CSV.
salesRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const where = buildWhere(req);
    const sales = await prisma.sale.findMany({
      where,
      include: {
        sellerOrg: { select: { name: true, type: true } },
        buyerOrg: { select: { name: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const header = [
      'SaleNumber',
      'Date',
      'Seller',
      'SellerTier',
      'Buyer',
      'Channel',
      'DistributionType',
      'SKU',
      'Product',
      'Qty',
      'UnitSRP',
      'UnitPrice',
      'LineTotal',
    ];
    const rows: string[] = [header.join(',')];
    for (const sale of sales) {
      for (const item of sale.items) {
        rows.push(
          [
            sale.number,
            sale.createdAt.toISOString(),
            csv(sale.sellerOrg.name),
            sale.sellerOrg.type,
            csv(sale.buyerOrg?.name ?? sale.customerName ?? 'Walk-in'),
            sale.channel,
            sale.distributionType,
            item.product.sku,
            csv(item.product.name),
            item.quantity,
            item.unitSrp,
            item.unitPrice,
            item.lineTotal,
          ].join(',')
        );
      }
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    res.send(rows.join('\n'));
  })
);

// GET /sales/:id — full receipt detail for a sale within scope.
salesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const sale = await loadScopedSale(req, req.params.id);
    res.json(receiptOf(sale, req.auth!.orgId));
  })
);

// POST /sales/:id/refund — refund pcs per item; adjusts the sale total and
// returns the refunded stock to the seller's inventory (Trade sales).
const refundSchema = z.object({
  items: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(0) })).min(1),
});

salesRouter.post(
  '/:id/refund',
  asyncHandler(async (req, res) => {
    const body = refundSchema.parse(req.body);
    // loadScopedSale already ensures the sale is within the requester's chain.
    const sale = await loadScopedSale(req, req.params.id);

    const byId = new Map(sale.items.map((i) => [i.id, i]));
    for (const r of body.items) {
      const item = byId.get(r.itemId);
      if (!item) throw badRequest(`Unknown sale item ${r.itemId}`);
      if (r.quantity > item.quantity - item.refundedQuantity) {
        throw badRequest(`Refund exceeds remaining quantity for ${item.product.name}`);
      }
    }
    const totalRefundQty = body.items.reduce((s, r) => s + r.quantity, 0);
    if (totalRefundQty <= 0) throw badRequest('Enter at least one item to refund');

    const updated = await prisma.$transaction(async (tx) => {
      for (const r of body.items) {
        if (r.quantity <= 0) continue;
        const item = byId.get(r.itemId)!;
        await tx.saleItem.update({
          where: { id: item.id },
          data: { refundedQuantity: { increment: r.quantity } },
        });
        // Trade sales deducted seller stock at sale time — return it now.
        if (sale.distributionType === 'TRADE') {
          await applyStockMovement(tx, {
            orgId: sale.sellerOrgId,
            productId: item.productId,
            change: r.quantity,
            reason: 'SALE_REFUND',
            refType: 'Sale',
            refId: sale.id,
            allowNegative: true,
          });
        }
      }
      // Recompute the sale's net totals from remaining (non-refunded) quantities.
      const items = await tx.saleItem.findMany({ where: { saleId: sale.id } });
      const subtotal = round2(items.reduce((s, i) => s + i.unitSrp * (i.quantity - i.refundedQuantity), 0));
      const total = round2(items.reduce((s, i) => s + i.unitPrice * (i.quantity - i.refundedQuantity), 0));
      return tx.sale.update({ where: { id: sale.id }, data: { subtotal, total } });
    });

    // Revenue value of this refund = Σ refunded qty × unit price.
    const refundAmount = round2(
      body.items.reduce((s, r) => s + r.quantity * (byId.get(r.itemId)!.unitPrice ?? 0), 0)
    );
    // Reverse Sales/AR in the finance books — ONLY the Principal's own sales are
    // posted there, so only those get reversed. Best-effort (never breaks refund).
    if (sale.sellerOrg.type === 'PRINCIPAL') {
      await postSaleRefundToBooks({
        refundId: `${sale.id}:${Date.now()}`,
        amount: refundAmount,
        date: new Date(),
        onAccount: sale.onAccount,
        label: `Refund on sale ${sale.number} — ${sale.sellerOrg.name}`,
        createdById: req.auth!.sub,
      });
    }

    res.json({ ok: true, refundedQty: totalRefundQty, refundAmount, newTotal: updated.total });
  })
);

// POST /sales/:id/email-receipt — email the receipt to a customer address.
salesRouter.post(
  '/:id/email-receipt',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const sale = await loadScopedSale(req, req.params.id);
    const result = await sendSaleReceiptEmail({ to: email, receipt: receiptOf(sale) });
    if (!result.sent) throw badRequest(result.reason ?? 'Could not send receipt');
    res.json({ sent: true });
  })
);

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
