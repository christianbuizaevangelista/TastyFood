import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { computeOrgKpis, parseWindow } from '../kpi/kpi.service';
import { excludeArchived } from '../../lib/scope';

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
    // Deleted (archived) accounts are dropped from rankings/top performers.
    const downstreamIds = await excludeArchived(scope.filter((id) => id !== myOrgId));

    // Current-month and previous-month boundaries (for the daily trend).
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [sales, ownInventory, activeDownstream, newMembers, lastMonthSales, downstreamKpis, myOrg] =
      await Promise.all([
        prisma.sale.findMany({
          where: { sellerOrgId: { in: scope }, createdAt: { gte: from, lte: to } },
          include: { items: true, sellerOrg: { select: { type: true, discountRate: true } } },
        }),
        prisma.inventory.findMany({
          where: { orgId: myOrgId },
          include: { product: { select: { srp: true } } },
        }),
        // Active downstream accounts (not deleted) — used to count this month's performers per tier.
        prisma.organization.findMany({
          where: {
            id: { in: scope },
            NOT: { id: myOrgId },
            type: { in: ['PROVINCIAL', 'CITY', 'RESELLER'] },
            status: 'APPROVED',
            isActive: true,
            archivedAt: null,
          },
          select: { id: true, type: true },
        }),
        // New members: downstream distributors/resellers added (active) this month.
        prisma.organization.count({
          where: {
            id: { in: scope },
            NOT: { id: myOrgId },
            type: { in: ['PROVINCIAL', 'CITY', 'RESELLER'] },
            status: 'APPROVED',
            isActive: true,
            archivedAt: null,
            createdAt: { gte: thisMonthStart },
          },
        }),
        prisma.sale.findMany({
          where: {
            sellerOrgId: { in: scope },
            createdAt: { gte: lastMonthStart, lt: thisMonthStart },
          },
          select: { total: true, createdAt: true },
        }),
        computeOrgKpis(downstreamIds, from, to),
        prisma.organization.findUnique({ where: { id: myOrgId }, select: { salesTarget: true } }),
      ]);

    const revenue = round2(sales.reduce((s, x) => s + x.total, 0));
    const units = sales.reduce((s, x) => s + x.items.reduce((u, i) => u + i.quantity, 0), 0);
    // Gross margin = sales minus acquisition cost. Acquisition cost for a seller
    // is their buy price (SRP minus their own tier discount); the Principal
    // manufactures, so its cost basis is 0.
    const acquisitionCost = (s: (typeof sales)[number]) =>
      s.sellerOrg.type === 'PRINCIPAL' ? 0 : s.subtotal * (1 - s.sellerOrg.discountRate);
    const grossMargin = round2(sales.reduce((g, x) => g + (x.total - acquisitionCost(x)), 0));

    // The logged-in org's own monthly sales vs its manually-set target.
    const ownRevenue = round2(
      sales.filter((s) => s.sellerOrgId === myOrgId).reduce((s, x) => s + x.total, 0)
    );
    const monthlyTarget = round2(myOrg?.salesTarget ?? 0);
    const targetAttainmentPct = monthlyTarget > 0 ? round2((ownRevenue / monthlyTarget) * 100) : null;
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

    // Active accounts per tier that recorded at least one sale this month
    // ("performing this month"), scoped to the requester's downstream.
    const typeById = new Map(activeDownstream.map((o) => [o.id, o.type]));
    const performedThisMonth = new Set<string>();
    for (const s of sales) {
      if (s.createdAt >= thisMonthStart && typeById.has(s.sellerOrgId)) performedThisMonth.add(s.sellerOrgId);
    }
    const activePerformers = { provincial: 0, city: 0, reseller: 0 };
    for (const id of performedThisMonth) {
      const t = typeById.get(id);
      if (t === 'PROVINCIAL') activePerformers.provincial++;
      else if (t === 'CITY') activePerformers.city++;
      else if (t === 'RESELLER') activePerformers.reseller++;
    }

    res.json({
      role: req.auth!.role,
      period: { from, to },
      cards: {
        totalRevenue: revenue,
        grossMargin,
        ownRevenue,
        monthlyTarget,
        targetAttainmentPct,
        salesUnits: units,
        inventoryValue,
        newMembers,
        activePerformers,
        lowStockItems: ownInventory.filter((r) => r.reorderLevel != null && r.quantity <= r.reorderLevel).length,
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
