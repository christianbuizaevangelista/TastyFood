import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound, badRequest } from '../../lib/errors';
import { appOrigin } from '../../lib/email';
import { sendOrientationThankYouEmail } from '../../lib/email.applications';
import { advanceLead } from '../public/public.service';

// Marketing System — a workspace separate from the DMS and Finance & Accounting.
// First module: Facebook Ads Management. Principal-only (owner or 'marketing').
export const marketingRouter = Router();
marketingRouter.use(authenticate);
marketingRouter.use(requireRole('PRINCIPAL'));
marketingRouter.use(requirePermission('marketing'));

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const campaignSchema = z.object({
  name: z.string().min(1).max(160),
  brand: z.enum(['TASTY_FOOD', 'JUANPALAMAN', 'CIELOS', 'CHRISTIAN_E']).default('TASTY_FOOD'),
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
    brand: b.brand,
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

// ---------------------------------------------------------------------------
// Lead Funnels — named pipelines with ordered stages. A lead sits in one stage
// while OPEN, then closes as WON or LOST. Funnel metrics show how many leads
// (and how much value) sit at each stage and where they drop off.
// ---------------------------------------------------------------------------

const SOURCES = ['FACEBOOK_ADS', 'WALK_IN', 'REFERRAL', 'WEBSITE', 'MANUAL'] as const;
// The tier an applicant wants to operate. Kept as a plain string on Lead so a
// funnel can be filtered by it without joining anything.
const INTERESTS = ['PROVINCIAL', 'CITY', 'RESELLER', 'RETAIL', 'UNSURE'] as const;

const funnelSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
  stages: z.array(z.string().min(1).max(60)).min(2).max(8),
});

const leadSchema = z.object({
  funnelId: z.string().min(1),
  name: z.string().min(1).max(160),
  company: z.string().max(160).nullable().optional(),
  phone: z.string().max(60).nullable().optional(),
  email: z.union([z.string().email(), z.literal('')]).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  province: z.string().max(120).nullable().optional(),
  interest: z.enum(INTERESTS).nullable().optional(),
  source: z.enum(SOURCES).default('MANUAL'),
  campaignId: z.string().nullable().optional(),
  stageIndex: z.number().int().min(0).default(0),
  value: z.number().min(0).default(0),
  note: z.string().max(1000).nullable().optional(),
});

interface LeadStat {
  stageIndex: number;
  status: string;
  value: number;
}

// Counts leads per stage and the conversion from each stage to the next.
// "Reached" a stage = the lead is sitting at it now or has already moved past it
// (a won lead has been through all of them), which is what makes the
// step-to-step drop-off meaningful rather than just a snapshot.
function funnelMetrics(stages: string[], leads: LeadStat[]) {
  const won = leads.filter((l) => l.status === 'WON');
  const lost = leads.filter((l) => l.status === 'LOST');
  const open = leads.filter((l) => l.status === 'OPEN');

  const rows = stages.map((name, i) => {
    const atStage = open.filter((l) => l.stageIndex === i);
    const reached = leads.filter((l) => l.status === 'WON' || (l.status !== 'LOST' && l.stageIndex >= i)).length;
    return {
      stage: name,
      index: i,
      current: atStage.length,
      currentValue: round2(atStage.reduce((s, l) => s + l.value, 0)),
      reached,
    };
  });
  const withConv = rows.map((r, i) => ({
    ...r,
    conversionPct: i === 0 ? 100 : rows[i - 1].reached > 0 ? round2((r.reached / rows[i - 1].reached) * 100) : 0,
  }));

  const closed = won.length + lost.length;
  return {
    stageStats: withConv,
    summary: {
      total: leads.length,
      open: open.length,
      won: won.length,
      lost: lost.length,
      openValue: round2(open.reduce((s, l) => s + l.value, 0)),
      wonValue: round2(won.reduce((s, l) => s + l.value, 0)),
      // Win rate is measured against CLOSED leads — still-open ones aren't losses yet.
      winRatePct: closed > 0 ? round2((won.length / closed) * 100) : 0,
      // Overall conversion is won out of every lead that ever entered the funnel.
      conversionPct: leads.length > 0 ? round2((won.length / leads.length) * 100) : 0,
    },
  };
}

// GET /marketing/funnels — all funnels with their headline metrics.
marketingRouter.get(
  '/funnels',
  asyncHandler(async (_req, res) => {
    const funnels = await prisma.leadFunnel.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { leads: { select: { stageIndex: true, status: true, value: true } } },
    });
    res.json({
      funnels: funnels.map(({ leads, ...f }) => ({ ...f, ...funnelMetrics(f.stages, leads) })),
    });
  })
);

// GET /marketing/funnels/:id — one funnel with its metrics and full lead list.
marketingRouter.get(
  '/funnels/:id',
  asyncHandler(async (req, res) => {
    const funnel = await prisma.leadFunnel.findUnique({
      where: { id: req.params.id },
      include: {
        leads: {
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
          include: { campaign: { select: { id: true, name: true } } },
        },
      },
    });
    if (!funnel) throw notFound('Funnel not found');
    const { leads, ...f } = funnel;
    res.json({ ...f, ...funnelMetrics(f.stages, leads), leads });
  })
);

// POST /marketing/funnels — create a funnel.
marketingRouter.post(
  '/funnels',
  asyncHandler(async (req, res) => {
    const b = funnelSchema.parse(req.body);
    const funnel = await prisma.leadFunnel.create({
      data: {
        name: b.name,
        description: b.description ?? null,
        isActive: b.isActive,
        stages: b.stages,
        createdById: req.auth!.sub,
      },
    });
    res.status(201).json(funnel);
  })
);

// PUT /marketing/funnels/:id — update a funnel.
marketingRouter.put(
  '/funnels/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.leadFunnel.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Funnel not found');
    const b = funnelSchema.parse(req.body);
    // Dropping stages would strand any lead sitting past the new last stage,
    // so pull those back to the final remaining stage.
    if (b.stages.length < existing.stages.length) {
      await prisma.lead.updateMany({
        where: { funnelId: existing.id, stageIndex: { gt: b.stages.length - 1 } },
        data: { stageIndex: b.stages.length - 1 },
      });
    }
    const funnel = await prisma.leadFunnel.update({
      where: { id: existing.id },
      data: {
        name: b.name,
        description: b.description ?? null,
        isActive: b.isActive,
        stages: b.stages,
      },
    });
    res.json(funnel);
  })
);

// DELETE /marketing/funnels/:id — remove a funnel and its leads.
marketingRouter.delete(
  '/funnels/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.leadFunnel.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Funnel not found');
    await prisma.leadFunnel.delete({ where: { id: existing.id } }); // leads cascade
    res.json({ ok: true });
  })
);

// Validates a lead against its funnel and normalises the optional fields.
async function leadData(b: z.infer<typeof leadSchema>) {
  const funnel = await prisma.leadFunnel.findUnique({ where: { id: b.funnelId } });
  if (!funnel) throw notFound('Funnel not found');
  if (b.stageIndex > funnel.stages.length - 1) throw badRequest('That stage does not exist in this funnel');
  if (b.campaignId) {
    const c = await prisma.fbAdCampaign.findUnique({ where: { id: b.campaignId } });
    if (!c) throw notFound('Campaign not found');
  }
  return {
    funnelId: b.funnelId,
    name: b.name,
    company: b.company || null,
    phone: b.phone || null,
    email: b.email || null,
    address: b.address || null,
    city: b.city || null,
    province: b.province || null,
    interest: b.interest || null,
    source: b.source,
    campaignId: b.campaignId || null,
    stageIndex: b.stageIndex,
    value: round2(b.value),
    note: b.note || null,
  };
}

// POST /marketing/leads — add a lead to a funnel.
marketingRouter.post(
  '/leads',
  asyncHandler(async (req, res) => {
    const b = leadSchema.parse(req.body);
    const lead = await prisma.lead.create({
      data: { ...(await leadData(b)), createdById: req.auth!.sub },
    });
    res.status(201).json(lead);
  })
);

// PUT /marketing/leads/:id — edit a lead's details.
marketingRouter.put(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Lead not found');
    const b = leadSchema.parse(req.body);
    const lead = await prisma.lead.update({ where: { id: existing.id }, data: await leadData(b) });
    res.json(lead);
  })
);

// PATCH /marketing/leads/:id/stage — move a lead, or close it as won/lost.
const moveSchema = z.object({
  stageIndex: z.number().int().min(0).optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  lostReason: z.string().max(400).nullable().optional(),
});
marketingRouter.patch(
  '/leads/:id/stage',
  asyncHandler(async (req, res) => {
    const existing = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { funnel: { select: { stages: true } } },
    });
    if (!existing) throw notFound('Lead not found');
    const b = moveSchema.parse(req.body);
    if (b.stageIndex !== undefined && b.stageIndex > existing.funnel.stages.length - 1) {
      throw badRequest('That stage does not exist in this funnel');
    }
    const status = b.status ?? existing.status;
    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        stageIndex: b.stageIndex ?? existing.stageIndex,
        status,
        lostReason: status === 'LOST' ? b.lostReason ?? existing.lostReason : null,
        // Stamp the close date when it closes; clear it if it is reopened.
        closedAt: status === 'OPEN' ? null : existing.closedAt ?? new Date(),
      },
    });
    res.json(lead);
  })
);

// DELETE /marketing/leads/:id — remove a lead.
marketingRouter.delete(
  '/leads/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Lead not found');
    await prisma.lead.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Landing page / Zoom orientation. The public side lives in modules/public;
// these routes are the Principal's control panel for it.
// ---------------------------------------------------------------------------

const webinarSchema = z.object({
  title: z.string().min(1).max(160),
  headline: z.string().max(300).nullable().optional(),
  description: z.string().max(3000).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  zoomLink: z.string().url().max(500).nullable().optional().or(z.literal('')),
  zoomMeetingId: z.string().max(60).nullable().optional(),
  zoomPasscode: z.string().max(60).nullable().optional(),
  isActive: z.boolean().default(true),
  funnelId: z.string().nullable().optional(),
  // The orientation runs several times so people can pick a slot. Sent as the
  // full list: whatever is omitted here is removed.
  sessions: z
    .array(
      z.object({
        id: z.string().optional(),
        scheduledAt: z.coerce.date(),
        zoomLink: z.string().url().max(500).nullable().optional().or(z.literal('')),
        zoomMeetingId: z.string().max(60).nullable().optional(),
        zoomPasscode: z.string().max(60).nullable().optional(),
        isActive: z.boolean().default(true),
      })
    )
    .max(20)
    .optional(),
});

// GET /marketing/webinar — the current landing-page configuration + sign-ups.
marketingRouter.get(
  '/webinar',
  asyncHandler(async (_req, res) => {
    const webinar = await prisma.webinar.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        funnel: { select: { id: true, name: true } },
        sessions: { orderBy: { scheduledAt: 'asc' } },
        registrations: { orderBy: { createdAt: 'desc' }, include: { session: { select: { id: true, scheduledAt: true } } } },
      },
    });
    if (!webinar) return res.json({ webinar: null, summary: null });
    const { registrations, ...w } = webinar;
    res.json({
      webinar: { ...w, registrations },
      summary: {
        total: registrations.length,
        attended: registrations.filter((r) => r.attended).length,
        converted: registrations.filter((r) => r.leadId).length,
      },
    });
  })
);

// PUT /marketing/webinar — create or update the landing page configuration.
marketingRouter.put(
  '/webinar',
  asyncHandler(async (req, res) => {
    const b = webinarSchema.parse(req.body);
    if (b.funnelId) {
      const f = await prisma.leadFunnel.findUnique({ where: { id: b.funnelId } });
      if (!f) throw notFound('Funnel not found');
    }
    const data = {
      title: b.title,
      headline: b.headline || null,
      description: b.description || null,
      scheduledAt: b.scheduledAt ?? null,
      zoomLink: b.zoomLink || null,
      zoomMeetingId: b.zoomMeetingId || null,
      zoomPasscode: b.zoomPasscode || null,
      isActive: b.isActive,
      funnelId: b.funnelId || null,
    };
    // A single landing page is edited in place rather than versioned.
    const existing = await prisma.webinar.findFirst({ orderBy: { createdAt: 'desc' } });
    const webinar = existing
      ? await prisma.webinar.update({ where: { id: existing.id }, data })
      : await prisma.webinar.create({ data: { ...data, createdById: req.auth!.sub } });

    // Sync the offered schedules against the list we were sent. Dropping a slot
    // only detaches it from its sign-ups (the registrations survive), so a
    // cancelled schedule never takes anyone's name with it.
    if (b.sessions) {
      const keep = b.sessions.map((s) => s.id).filter(Boolean) as string[];
      await prisma.webinarSession.deleteMany({
        where: { webinarId: webinar.id, id: { notIn: keep.length ? keep : ['-'] } },
      });
      for (const s of b.sessions) {
        const row = {
          scheduledAt: s.scheduledAt,
          zoomLink: s.zoomLink || null,
          zoomMeetingId: s.zoomMeetingId || null,
          zoomPasscode: s.zoomPasscode || null,
          isActive: s.isActive,
        };
        if (s.id) {
          await prisma.webinarSession.updateMany({
            where: { id: s.id, webinarId: webinar.id },
            data: row,
          });
        } else {
          await prisma.webinarSession.create({ data: { ...row, webinarId: webinar.id } });
        }
      }
    }

    const full = await prisma.webinar.findUnique({
      where: { id: webinar.id },
      include: { sessions: { orderBy: { scheduledAt: 'asc' } } },
    });
    res.json(full);
  })
);

// PATCH /marketing/webinar/registrations/:id — mark attendance.
marketingRouter.patch(
  '/webinar/registrations/:id',
  asyncHandler(async (req, res) => {
    const { attended } = z.object({ attended: z.boolean() }).parse(req.body);
    const existing = await prisma.webinarRegistration.findUnique({
      where: { id: req.params.id },
      include: { webinar: { select: { title: true } } },
    });
    if (!existing) throw notFound('Registration not found');

    // Ticking attendance sends a thank-you immediately, and that cannot be
    // unsent — so the tick is one-way. Otherwise an accidental un-tick and
    // re-tick would mail the same person twice.
    if (existing.attended && !attended) {
      throw badRequest('Attendance has already been recorded and cannot be undone');
    }
    if (existing.attended && attended) return res.json(existing);

    const reg = await prisma.webinarRegistration.update({
      where: { id: existing.id },
      data: { attended, ...(attended ? { thankYouAt: new Date() } : {}) },
    });
    res.json(reg);

    if (attended && !existing.thankYouAt) {
      // Thank them while the session is still fresh, and move the lead.
      sendOrientationThankYouEmail({
        to: reg.email,
        name: reg.name,
        title: existing.webinar.title,
        applyUrl: `${appOrigin()}/apply?ref=${reg.id}`,
      })
        .then((out) => {
          if (!out.sent) {
            // Clear the stamp so it can be retried rather than lost.
            return prisma.webinarRegistration
              .update({ where: { id: reg.id }, data: { thankYouAt: null } })
              .then(() => undefined);
          }
          return advanceLead(reg.leadId, ['attend', 'orientation']);
        })
        .catch((e) => console.error('[webinar] thank-you failed', e?.message));
    }
  })
);

// DELETE /marketing/webinar/registrations/:id — remove a sign-up (spam, test,
// or a duplicate). The public form is open to anyone, so junk entries happen.
marketingRouter.delete(
  '/webinar/registrations/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.webinarRegistration.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Registration not found');
    await prisma.webinarRegistration.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

// GET /marketing/webinar/registrations.csv — export the sign-up list.
marketingRouter.get(
  '/webinar/registrations.csv',
  asyncHandler(async (_req, res) => {
    const webinar = await prisma.webinar.findFirst({ orderBy: { createdAt: 'desc' } });
    const rows = webinar
      ? await prisma.webinarRegistration.findMany({
          where: { webinarId: webinar.id },
          orderBy: { createdAt: 'desc' },
          include: { session: { select: { scheduledAt: true } } },
        })
      : [];
    // Quote every field and double embedded quotes so commas in an address or
    // message can't shift the columns.
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Registered', 'Name', 'Email', 'Phone', 'City', 'Province', 'Interest', 'Schedule', 'Attended', 'Message'];
    const csv = [
      header.join(','),
      ...rows.map((r) =>
        [
          new Date(r.createdAt).toISOString(),
          r.name,
          r.email,
          r.phone,
          r.city,
          r.province,
          r.interest,
          r.session ? new Date(r.session.scheduledAt).toISOString() : '',
          r.attended ? 'YES' : 'NO',
          r.message,
        ]
          .map(esc)
          .join(',')
      ),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="webinar-registrations.csv"');
    res.send(csv);
  })
);
