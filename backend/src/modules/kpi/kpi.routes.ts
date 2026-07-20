import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission, assertInScope } from '../../middleware/rbac';
import { forbidden, notFound } from '../../lib/errors';
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

// ---------------------------------------------------------------------------
// Monthly targets. Demand is seasonal, so each org can carry a figure per month;
// months without one fall back to the org's default salesTarget.
// ---------------------------------------------------------------------------

// GET /kpi/targets/:orgId?year=2026 — the twelve months for one account.
kpiRouter.get(
  '/targets/:orgId',
  asyncHandler(async (req, res) => {
    assertInScope(req, req.params.orgId);
    const year = Number(req.query.year) || new Date().getFullYear();
    const org = await prisma.organization.findUnique({
      where: { id: req.params.orgId },
      select: { id: true, name: true, salesTarget: true },
    });
    if (!org) throw notFound('Organization not found');
    const rows = await prisma.monthlyTarget.findMany({
      where: { orgId: org.id, year },
      orderBy: { month: 'asc' },
    });
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const row = byMonth.get(m);
      return {
        month: m,
        // `custom` distinguishes a deliberate figure for this month from the
        // inherited default, so the UI can show which months were actually set.
        custom: !!row,
        target: row ? row.target : org.salesTarget,
        note: row?.note ?? null,
      };
    });
    res.json({ org: { id: org.id, name: org.name, defaultTarget: org.salesTarget }, year, months });
  })
);

// PUT /kpi/targets/:orgId — set or clear months for one account (Principal only).
const targetsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  months: z
    .array(
      z.object({
        month: z.number().int().min(1).max(12),
        // null clears the month, so it falls back to the default again.
        target: z.number().min(0).nullable(),
        note: z.string().max(200).nullable().optional(),
      })
    )
    .min(1)
    .max(12),
});
kpiRouter.put(
  '/targets/:orgId',
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'PRINCIPAL') throw forbidden('Only the Principal can set targets');
    assertInScope(req, req.params.orgId);
    const body = targetsSchema.parse(req.body);
    const org = await prisma.organization.findUnique({ where: { id: req.params.orgId }, select: { id: true } });
    if (!org) throw notFound('Organization not found');

    for (const m of body.months) {
      if (m.target === null) {
        await prisma.monthlyTarget.deleteMany({ where: { orgId: org.id, year: body.year, month: m.month } });
      } else {
        await prisma.monthlyTarget.upsert({
          where: { orgId_year_month: { orgId: org.id, year: body.year, month: m.month } },
          create: { orgId: org.id, year: body.year, month: m.month, target: m.target, note: m.note ?? null },
          update: { target: m.target, note: m.note ?? null },
        });
      }
    }
    const rows = await prisma.monthlyTarget.findMany({ where: { orgId: org.id, year: body.year }, orderBy: { month: 'asc' } });
    res.json({ year: body.year, saved: rows.length });
  })
);
