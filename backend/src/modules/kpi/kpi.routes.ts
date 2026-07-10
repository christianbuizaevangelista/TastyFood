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
// Optional ?tier=PROVINCIAL|CITY|RESELLER|RETAIL to focus a group. RETAIL
// (retail distributors) is a SEPARATE board and is excluded from the others.
kpiRouter.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const { from, to } = parseWindow(req.query);
    const tier = req.query.tier as string | undefined;

    // Downstream only, excluding deleted (archived) accounts.
    const scopeIds = await excludeArchived(req.scopeOrgIds!.filter((id) => id !== req.auth!.orgId));
    const orgs = await prisma.organization.findMany({
      where: { id: { in: scopeIds } },
      select: { id: true, type: true, segment: true },
    });
    let orgIds: string[];
    if (tier === 'RETAIL') {
      orgIds = orgs.filter((o) => o.segment === 'RETAIL').map((o) => o.id);
    } else if (tier) {
      // A reseller-channel tier — never include retail distributors.
      orgIds = orgs.filter((o) => o.type === tier && o.segment !== 'RETAIL').map((o) => o.id);
    } else {
      // Default board = reseller-channel downstream only (retail has its own).
      orgIds = orgs.filter((o) => o.segment !== 'RETAIL').map((o) => o.id);
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
