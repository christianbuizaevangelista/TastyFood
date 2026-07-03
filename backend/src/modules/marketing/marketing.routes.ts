import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound } from '../../lib/errors';

// Marketing System — a workspace separate from the DMS and Finance & Accounting.
// First module: Facebook Ads Management. Principal-only (owner or 'marketing').
export const marketingRouter = Router();
marketingRouter.use(authenticate);
marketingRouter.use(requireRole('PRINCIPAL'));
marketingRouter.use(requirePermission('marketing'));

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const campaignSchema = z.object({
  name: z.string().min(1).max(160),
  objective: z.enum(['AWARENESS', 'TRAFFIC', 'ENGAGEMENT', 'LEADS', 'SALES']).default('AWARENESS'),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).default('ACTIVE'),
  budget: z.number().min(0).default(0),
  spend: z.number().min(0).default(0),
  reach: z.number().int().min(0).default(0),
  impressions: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  leads: z.number().int().min(0).default(0),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

function toData(b: z.infer<typeof campaignSchema>) {
  return {
    name: b.name,
    objective: b.objective,
    status: b.status,
    budget: round2(b.budget),
    spend: round2(b.spend),
    reach: b.reach,
    impressions: b.impressions,
    clicks: b.clicks,
    leads: b.leads,
    startDate: b.startDate ?? null,
    endDate: b.endDate ?? null,
    notes: b.notes ?? null,
  };
}

// GET /marketing/fb-ads — campaigns + aggregate performance summary.
marketingRouter.get(
  '/fb-ads',
  asyncHandler(async (_req, res) => {
    const campaigns = await prisma.fbAdCampaign.findMany({ orderBy: { createdAt: 'desc' } });
    const s = campaigns.reduce(
      (a, c) => {
        a.budget += c.budget;
        a.spend += c.spend;
        a.reach += c.reach;
        a.impressions += c.impressions;
        a.clicks += c.clicks;
        a.leads += c.leads;
        return a;
      },
      { budget: 0, spend: 0, reach: 0, impressions: 0, clicks: 0, leads: 0 }
    );
    const summary = {
      count: campaigns.length,
      active: campaigns.filter((c) => c.status === 'ACTIVE').length,
      budget: round2(s.budget),
      spend: round2(s.spend),
      reach: s.reach,
      impressions: s.impressions,
      clicks: s.clicks,
      leads: s.leads,
      ctr: s.impressions > 0 ? round2((s.clicks / s.impressions) * 100) : 0, // click-through %
      cpl: s.leads > 0 ? round2(s.spend / s.leads) : 0, // cost per lead
      cpc: s.clicks > 0 ? round2(s.spend / s.clicks) : 0, // cost per click
    };
    res.json({ campaigns, summary });
  })
);

// POST /marketing/fb-ads — create a campaign.
marketingRouter.post(
  '/fb-ads',
  asyncHandler(async (req, res) => {
    const b = campaignSchema.parse(req.body);
    const campaign = await prisma.fbAdCampaign.create({
      data: { ...toData(b), createdById: req.auth!.sub },
    });
    res.status(201).json(campaign);
  })
);

// PUT /marketing/fb-ads/:id — edit a campaign.
marketingRouter.put(
  '/fb-ads/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.fbAdCampaign.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Campaign not found');
    const b = campaignSchema.parse(req.body);
    const campaign = await prisma.fbAdCampaign.update({ where: { id: existing.id }, data: toData(b) });
    res.json(campaign);
  })
);

// DELETE /marketing/fb-ads/:id — remove a campaign.
marketingRouter.delete(
  '/fb-ads/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.fbAdCampaign.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Campaign not found');
    await prisma.fbAdCampaign.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);
