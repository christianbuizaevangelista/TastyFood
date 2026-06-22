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

    // Current-month and previous-month boundaries (for the daily trend).
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [sales, ownInventory, activeMembers, pendingApprovals, lastMonthSales, downstreamKpis] =
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
            createdAt: { gte: lastMonthStart, lt: thisMonthStart },
          },
          select: { total: true, createdAt: true },
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

    // Daily revenue for the current month, with last month overlaid by day.
    const daysInThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyRevenue = Array.from({ length: daysInThisMonth }, (_, i) => ({
      day: i + 1,
      thisMonth: 0,
      lastMonth: 0,
    }));
    for (const s of sales) {
      const idx = s.createdAt.getDate() - 1;
      if (idx >= 0 && idx < daysInThisMonth) dailyRevenue[idx].thisMonth += s.total;
    }
    for (const s of lastMonthSales) {
      const idx = s.createdAt.getDate() - 1;
      if (idx >= 0 && idx < daysInThisMonth) dailyRevenue[idx].lastMonth += s.total;
    }
    for (const d of dailyRevenue) {
      d.thisMonth = round2(d.thisMonth);
      d.lastMonth = round2(d.lastMonth);
    }
    const lastMonthTotal = round2(lastMonthSales.reduce((s, x) => s + x.total, 0));

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
        currentMonth: {
          label: thisMonthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
          lastMonthLabel: lastMonthStart.toLocaleString('en-US', { month: 'long' }),
          dailyRevenue,
          thisMonthTotal: revenue,
          lastMonthTotal,
        },
        byDistributionType: byType,
        topPerformers,
      },
    });
  })
);
