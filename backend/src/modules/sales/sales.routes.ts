import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';

export const salesRouter = Router();
salesRouter.use(authenticate);

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
        sellerOrg: { select: { id: true, name: true, type: true } },
        buyerOrg: { select: { id: true, name: true, type: true } },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const summary = {
      count: sales.length,
      revenue: round2(sales.reduce((s, x) => s + x.total, 0)),
      units: sales.reduce((s, x) => s + x.items.reduce((u, i) => u + i.quantity, 0), 0),
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
    };

    res.json({ summary, sales });
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

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
