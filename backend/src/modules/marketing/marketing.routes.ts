import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound, badRequest } from '../../lib/errors';

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

// ---------------------------------------------------------------------------
// Facebook (Meta) Marketing API sync
// ---------------------------------------------------------------------------
const FB_VER = 'v21.0';
const gfetch: (url: string) => Promise<any> = (globalThis as any).fetch;

function mapObjective(o: string): string {
  const s = (o || '').toUpperCase();
  if (s.includes('LEAD')) return 'LEADS';
  if (s.includes('SALES') || s.includes('CONVERSION') || s.includes('CATALOG')) return 'SALES';
  if (s.includes('TRAFFIC') || s.includes('LINK_CLICK')) return 'TRAFFIC';
  if (s.includes('ENGAGEMENT') || s.includes('MESSAGE') || s.includes('VIDEO') || s.includes('LIKE')) return 'ENGAGEMENT';
  return 'AWARENESS'; // AWARENESS / REACH / default
}
function mapStatus(s: string): string {
  const u = (s || '').toUpperCase();
  if (u === 'ACTIVE') return 'ACTIVE';
  if (u === 'PAUSED') return 'PAUSED';
  return 'COMPLETED'; // ARCHIVED / DELETED / etc.
}

// Fetch every page of a Graph API edge.
async function fbGetAll(path: string, params: Record<string, string>, token: string): Promise<any[]> {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  let next: string | null = `https://graph.facebook.com/${FB_VER}/${path}?${qs}`;
  const out: any[] = [];
  let guard = 0;
  while (next && guard++ < 50) {
    const res = await gfetch(next);
    const j = await res.json();
    if (j.error) throw badRequest(`Facebook: ${j.error.message}`);
    out.push(...(j.data || []));
    next = j.paging?.next ?? null;
  }
  return out;
}

// POST /marketing/fb-ads/sync — pull campaigns + insights from the connected
// Meta ad account and upsert them (keyed by fbCampaignId). Manual campaigns are
// left untouched. Requires FB_ADS_TOKEN + FB_AD_ACCOUNT_ID env vars.
marketingRouter.post(
  '/fb-ads/sync',
  asyncHandler(async (req, res) => {
    const token = process.env.FB_ADS_TOKEN;
    const acct = process.env.FB_AD_ACCOUNT_ID;
    if (!token || !acct) {
      throw badRequest('Facebook is not connected yet. Ask your admin to set the Meta access token and ad account.');
    }
    const actId = acct.startsWith('act_') ? acct : `act_${acct}`;

    const campaigns = await fbGetAll(
      `${actId}/campaigns`,
      { fields: 'name,objective,status,daily_budget,lifetime_budget,start_time,stop_time', limit: '200' },
      token
    );
    const insights = await fbGetAll(
      `${actId}/insights`,
      { level: 'campaign', fields: 'campaign_id,spend,reach,impressions,clicks,actions', date_preset: 'maximum', limit: '200' },
      token
    );
    const insByCampaign = new Map<string, any>(insights.map((i) => [i.campaign_id, i]));

    let synced = 0;
    for (const c of campaigns) {
      const ins = insByCampaign.get(c.id) ?? {};
      const leads = (ins.actions ?? [])
        .filter((a: any) => /lead/i.test(a.action_type))
        .reduce((s: number, a: any) => s + Number(a.value || 0), 0);
      // Campaign budgets are in currency minor units (÷100); insights spend is
      // already in major units.
      const budget = round2(Number(c.daily_budget || c.lifetime_budget || 0) / 100);
      const data = {
        name: c.name ?? '(untitled)',
        objective: mapObjective(c.objective),
        status: mapStatus(c.status),
        budget,
        spend: round2(Number(ins.spend || 0)),
        reach: Math.round(Number(ins.reach || 0)),
        impressions: Math.round(Number(ins.impressions || 0)),
        clicks: Math.round(Number(ins.clicks || 0)),
        leads: Math.round(leads),
        startDate: c.start_time ? new Date(c.start_time) : null,
        endDate: c.stop_time ? new Date(c.stop_time) : null,
        source: 'FACEBOOK',
        lastSyncedAt: new Date(),
      };
      await prisma.fbAdCampaign.upsert({
        where: { fbCampaignId: c.id },
        update: data,
        create: { ...data, fbCampaignId: c.id, createdById: req.auth!.sub },
      });
      synced++;
    }
    res.json({ synced });
  })
);

// GET /marketing/fb-ads/connection — is Facebook wired up (env present)?
marketingRouter.get(
  '/fb-ads/connection',
  asyncHandler(async (_req, res) => {
    res.json({ connected: !!(process.env.FB_ADS_TOKEN && process.env.FB_AD_ACCOUNT_ID) });
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
