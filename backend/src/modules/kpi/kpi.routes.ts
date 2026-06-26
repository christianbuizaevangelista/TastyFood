import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { computeOrgKpis, parseWindow } from './kpi.service';
import { excludeArchived } from '../../lib/scope';

export const kpiRouter = Router();
kpiRouter.use(authenticate);
kpiRouter.use(requirePermission('kpi'));

// GET /kpi/leaderboard — ranked KPIs for downstream orgs in scope.
// Optional ?tier=PROVINCIAL|CITY|RESELLER to focus a tier.
kpiRouter.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const { from, to } = parseWindow(req.query);
    const tier = req.query.tier as string | undefined;

    // Downstream only, excluding deleted (archived) accounts.
    let orgIds = await excludeArchived(req.scopeOrgIds!.filter((id) => id !== req.auth!.orgId));
    if (tier) {
      const tierOrgs = await prisma.organization.findMany({
        where: { id: { in: orgIds }, type: tier as any },
        select: { id: true },
      });
      orgIds = tierOrgs.map((o) => o.id);
    }

    const kpis = await computeOrgKpis(orgIds, from, to);
    kpis.sort((a, b) => b.revenue - a.revenue);

    res.json({
      period: { from, to },
      ranked: kpis,
      top: kpis.slice(0, 5),
      bottom: [...kpis].reverse().slice(0, 5),
    });
  })
);

// GET /kpi/me — KPIs for the requester's own org.
kpiRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { from, to } = parseWindow(req.query);
    const [kpi] = await computeOrgKpis([req.auth!.orgId], from, to);
    res.json({ period: { from, to }, kpi: kpi ?? null });
  })
);
