import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound } from '../../lib/errors';
import { AdStats, buildPeers, metrics, score } from '../../lib/adScore';
import { AD_AUDIENCES, AD_BRANDS, TARGETING_PRESETS } from '../../lib/adTargeting';

// Campaign → ad set → ad, with a score on every level. Mounted ahead of the
// general marketing router so these paths match first.
export const adsRouter = Router();
adsRouter.use(authenticate);
adsRouter.use(requireRole('PRINCIPAL'));
adsRouter.use(requirePermission('marketing'));

const BRANDS = AD_BRANDS.map((b) => b.key) as unknown as [string, ...string[]];
const STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED'] as const;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// GET /marketing/ads/targeting — the audience library and brand list.
adsRouter.get(
  '/targeting',
  asyncHandler(async (_req, res) => {
    res.json({ brands: AD_BRANDS, audiences: AD_AUDIENCES, presets: TARGETING_PRESETS });
  })
);

function totals(rows: AdStats[]): AdStats {
  return rows.reduce(
    (a, r) => ({
      spend: a.spend + r.spend,
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      leads: a.leads + r.leads,
      reach: (a.reach ?? 0) + (r.reach ?? 0),
      purchases: (a.purchases ?? 0) + (r.purchases ?? 0),
      revenue: (a.revenue ?? 0) + (r.revenue ?? 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, reach: 0, purchases: 0, revenue: 0 }
  );
}

// GET /marketing/ads — the whole tree for a brand, scored.
adsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const brand = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand : null;

    const campaigns = await prisma.fbAdCampaign.findMany({
      where: brand ? { brand } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        adSets: {
          orderBy: { createdAt: 'desc' },
          include: { ads: { orderBy: { createdAt: 'desc' } } },
        },
      },
    });

    // Every ad in the account is the comparison pool, so a score means "against
    // everything you have run", not just against its own campaign — which would
    // let a weak campaign hand out A grades to its least bad ad.
    const allAds = campaigns.flatMap((c) => c.adSets.flatMap((s) => s.ads));
    const allSets = campaigns.flatMap((c) => c.adSets);
    const adPeers = buildPeers(allAds);
    const setPeers = buildPeers(allSets);
    const campaignPeers = buildPeers(campaigns);

    const shaped = campaigns.map((c) => ({
      ...c,
      metrics: metrics(c),
      score: score(c, c.objective, campaignPeers),
      adSets: c.adSets.map((s) => ({
        ...s,
        metrics: metrics(s),
        score: score(s, c.objective, setPeers),
        // An ad set's own numbers can lag its ads while a sync is partial, so
        // show what the ads under it actually add up to.
        adTotals: totals(s.ads),
        ads: s.ads.map((a) => ({
          ...a,
          metrics: metrics(a),
          score: score(a, c.objective, adPeers),
        })),
      })),
    }));

    const t = totals(campaigns);
    const m = metrics(t);

    // The single most useful answer on the page: which ad is winning.
    const scoredAds = shaped
      .flatMap((c) =>
        c.adSets.flatMap((s) =>
          s.ads.map((a) => ({
            id: a.id,
            name: a.name,
            campaign: c.name,
            adSet: s.name,
            brand: c.brand,
            score: a.score,
            metrics: a.metrics,
            spend: a.spend,
            leads: a.leads,
          }))
        )
      )
      .filter((a) => a.score.value !== null)
      .sort((x, y) => (y.score.value ?? 0) - (x.score.value ?? 0));

    res.json({
      campaigns: shaped,
      summary: {
        campaigns: campaigns.length,
        adSets: allSets.length,
        ads: allAds.length,
        spend: round2(t.spend),
        leads: t.leads,
        clicks: t.clicks,
        impressions: t.impressions,
        revenue: round2(t.revenue ?? 0),
        purchases: t.purchases ?? 0,
        ...m,
      },
      best: scoredAds.slice(0, 3),
      worst: scoredAds.slice(-3).reverse(),
      // Anything burning money without returning any is worth naming outright.
      attention: shaped
        .flatMap((c) => c.adSets.flatMap((s) => s.ads.map((a) => ({ ...a, campaign: c.name, adSet: s.name }))))
        .filter((a) => a.score.flags.length > 0)
        .map((a) => ({ id: a.id, name: a.name, campaign: a.campaign, adSet: a.adSet, spend: a.spend, flags: a.score.flags })),
    });
  })
);

const setSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().min(1).max(160),
  status: z.enum(STATUSES).default('ACTIVE'),
  budget: z.number().min(0).default(0),
  spend: z.number().min(0).default(0),
  reach: z.number().int().min(0).default(0),
  impressions: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  leads: z.number().int().min(0).default(0),
  ageMin: z.number().int().min(13).max(65).nullable().optional(),
  ageMax: z.number().int().min(13).max(65).nullable().optional(),
  genders: z.enum(['ALL', 'MALE', 'FEMALE']).default('ALL'),
  locations: z.array(z.string().max(120)).max(30).default([]),
  interests: z.array(z.string().max(120)).max(30).default([]),
  behaviours: z.array(z.string().max(120)).max(30).default([]),
  placements: z.array(z.string().max(120)).max(20).default([]),
  audience: z.enum(AD_AUDIENCES).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

function setData(b: z.infer<typeof setSchema>) {
  return {
    campaignId: b.campaignId,
    name: b.name,
    status: b.status,
    budget: round2(b.budget),
    spend: round2(b.spend),
    reach: b.reach,
    impressions: b.impressions,
    clicks: b.clicks,
    leads: b.leads,
    ageMin: b.ageMin ?? null,
    ageMax: b.ageMax ?? null,
    genders: b.genders,
    locations: b.locations,
    interests: b.interests,
    behaviours: b.behaviours,
    placements: b.placements,
    audience: b.audience ?? null,
    notes: b.notes ?? null,
  };
}

adsRouter.post(
  '/sets',
  asyncHandler(async (req, res) => {
    const b = setSchema.parse(req.body);
    const campaign = await prisma.fbAdCampaign.findUnique({ where: { id: b.campaignId } });
    if (!campaign) throw notFound('Campaign not found');
    const set = await prisma.fbAdSet.create({ data: { ...setData(b), createdById: req.auth!.sub } });
    res.status(201).json(set);
  })
);

adsRouter.put(
  '/sets/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.fbAdSet.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Ad set not found');
    const b = setSchema.parse(req.body);
    const set = await prisma.fbAdSet.update({ where: { id: existing.id }, data: setData(b) });
    res.json(set);
  })
);

adsRouter.delete(
  '/sets/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.fbAdSet.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Ad set not found');
    await prisma.fbAdSet.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

const adSchema = z.object({
  adSetId: z.string().min(1),
  name: z.string().min(1).max(160),
  status: z.enum(STATUSES).default('ACTIVE'),
  format: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL', 'REELS', 'STORY']).default('IMAGE'),
  headline: z.string().max(200).nullable().optional(),
  primaryText: z.string().max(2000).nullable().optional(),
  callToAction: z.string().max(60).nullable().optional(),
  mediaUrl: z.string().max(500).nullable().optional(),
  spend: z.number().min(0).default(0),
  reach: z.number().int().min(0).default(0),
  impressions: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  leads: z.number().int().min(0).default(0),
});

function adData(b: z.infer<typeof adSchema>) {
  return {
    adSetId: b.adSetId,
    name: b.name,
    status: b.status,
    format: b.format,
    headline: b.headline ?? null,
    primaryText: b.primaryText ?? null,
    callToAction: b.callToAction ?? null,
    mediaUrl: b.mediaUrl ?? null,
    spend: round2(b.spend),
    reach: b.reach,
    impressions: b.impressions,
    clicks: b.clicks,
    leads: b.leads,
  };
}

adsRouter.post(
  '/ads',
  asyncHandler(async (req, res) => {
    const b = adSchema.parse(req.body);
    const set = await prisma.fbAdSet.findUnique({ where: { id: b.adSetId } });
    if (!set) throw notFound('Ad set not found');
    const ad = await prisma.fbAd.create({ data: { ...adData(b), createdById: req.auth!.sub } });
    res.status(201).json(ad);
  })
);

adsRouter.put(
  '/ads/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.fbAd.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Ad not found');
    const b = adSchema.parse(req.body);
    const ad = await prisma.fbAd.update({ where: { id: existing.id }, data: adData(b) });
    res.json(ad);
  })
);

adsRouter.delete(
  '/ads/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.fbAd.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Ad not found');
    await prisma.fbAd.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);
