import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { computeOrgKpis, parseWindow } from '../kpi/kpi.service';
import { pendingApprovalsCount } from '../crm/approvals.service';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// GET /dashboard — role-aware KPI cards + chart data, scoped to the chain.
dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.scopeOrgIds!;
    const myOrgId = req.auth!.orgId;
    const { from, to } = parseWindow(req.query);

    const [sales, ownInventory, activeMembers, pendingApprovals, sixMonthSales, downstreamKpis] =
      await Promise.all([
        prisma.sale.findMany({
          where: { sellerOrgId: { in: scope }, createdAt: { gte: from, lte: to } },
          include: { items: true },
        }),
        prisma.inventory.findMany({
          where: { orgId: myOrgId },
          include: { product: { select: { srp: true } } },
        }),
        prisma.organization.count({
          where: { id: { in: scope }, NOT: { id: myOrgId }, status: 'APPROVED', isActive: true },
        }),
        pendingApprovalsCount(req.auth!.role, myOrgId),
        prisma.sale.findMany({
          where: {
            sellerOrgId: { in: scope },
            createdAt: { gte: new Date(new Date().setMonth(new Date().getMonth() - 5, 1)) },
          },
          select: { total: true, createdAt: true, distributionType: true },
        }),
        computeOrgKpis(
          scope.filter((id) => id !== myOrgId),
          from,
          to
        ),
      ]);

    const revenue = round2(sales.reduce((s, x) => s + x.total, 0));
    const units = sales.reduce((s, x) => s + x.items.reduce((u, i) => u + i.quantity, 0), 0);
    const inventoryValue = round2(
      ownInventory.reduce((s, r) => s + r.quantity * r.product.srp, 0)
    );

    // Monthly revenue trend (last 6 months).
    const months: { key: string; label: string; revenue: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString('en-US', { month: 'short' }),
        revenue: 0,
      });
    }
    const monthIndex = new Map(months.map((m, idx) => [m.key, idx]));
    for (const s of sixMonthSales) {
      const key = `${s.createdAt.getFullYear()}-${s.createdAt.getMonth()}`;
      const idx = monthIndex.get(key);
      if (idx !== undefined) months[idx].revenue = round2(months[idx].revenue + s.total);
    }

    const byType = {
      trade: round2(
        sales.filter((s) => s.distributionType === 'TRADE').reduce((s, x) => s + x.total, 0)
      ),
      dropShip: round2(
        sales.filter((s) => s.distributionType === 'DROP_SHIP').reduce((s, x) => s + x.total, 0)
      ),
    };

    const topPerformers = [...downstreamKpis]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((k) => ({ orgId: k.orgId, name: k.orgName, type: k.orgType, revenue: k.revenue }));

    res.json({
      role: req.auth!.role,
      period: { from, to },
      cards: {
        totalRevenue: revenue,
        salesUnits: units,
        inventoryValue,
        pendingApprovals,
        activeMembers,
        lowStockItems: ownInventory.filter((r) => r.quantity <= r.reorderLevel).length,
      },
      charts: {
        monthlyRevenue: months,
        byDistributionType: byType,
        topPerformers,
      },
    });
  })
);
