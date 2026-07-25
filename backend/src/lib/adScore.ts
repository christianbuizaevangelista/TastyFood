// Scoring for ads, ad sets and campaigns.
//
// The score is deliberately RELATIVE to this account's own history, not to
// published "industry benchmarks". A benchmark for peanut butter distributor
// recruitment in Cavite does not exist, and inventing one would produce a
// number that looks authoritative and means nothing. Comparing an ad to the
// others this business has actually run answers the question that matters —
// "is this one worth more money than the rest?" — and it stays true as the
// account grows.
//
// Nothing is scored until there is enough traffic to judge it. An ad with 40
// impressions has no signal, and putting a grade on it would invite a decision
// the data cannot support.

export const MIN_IMPRESSIONS = 500;

export interface AdStats {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach?: number;
  purchases?: number; // completed purchases (from the ad platform)
  revenue?: number; // peso value of those purchases, for ROAS
}

export interface Metrics {
  ctr: number | null; // click-through rate, %
  cpc: number | null; // cost per click
  cpl: number | null; // cost per lead — the one that decides the budget
  cvr: number | null; // clicks that became leads, %
  cpm: number | null; // cost per 1,000 impressions
  roas: number | null; // return on ad spend — revenue ÷ spend (× return per ₱1)
  cpp: number | null; // cost per purchase
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function metrics(s: AdStats): Metrics {
  const purchases = s.purchases ?? 0;
  const revenue = s.revenue ?? 0;
  return {
    ctr: s.impressions > 0 ? r2((s.clicks / s.impressions) * 100) : null,
    cpc: s.clicks > 0 ? r2(s.spend / s.clicks) : null,
    cpl: s.leads > 0 ? r2(s.spend / s.leads) : null,
    cvr: s.clicks > 0 ? r2((s.leads / s.clicks) * 100) : null,
    cpm: s.impressions > 0 ? r2((s.spend / s.impressions) * 1000) : null,
    roas: s.spend > 0 && revenue > 0 ? r2(revenue / s.spend) : null,
    cpp: purchases > 0 ? r2(s.spend / purchases) : null,
  };
}

// Where a value sits among its peers, 0..1. Lower-is-better metrics (cost) are
// inverted so that 1 always means "good".
function percentile(value: number, peers: number[], lowerIsBetter: boolean): number {
  const pool = peers.filter((p) => Number.isFinite(p));
  if (pool.length < 2) return 0.5; // nothing to compare against yet
  const better = pool.filter((p) => (lowerIsBetter ? p > value : p < value)).length;
  return better / (pool.length - 1 > 0 ? pool.length - 1 : 1);
}

export interface Peers {
  ctr: number[];
  cpl: number[];
  cvr: number[];
  cpc: number[];
}

export interface Score {
  value: number | null; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | null;
  reason: string;
  flags: string[];
}

// What each metric is worth depends on what the campaign was for. A brand
// awareness ad judged on cost per lead would always look like a failure.
function weightsFor(objective: string): { ctr: number; cpl: number; cvr: number; cpc: number } {
  switch (objective) {
    case 'LEADS':
    case 'SALES':
      return { ctr: 0.15, cpl: 0.5, cvr: 0.25, cpc: 0.1 };
    case 'TRAFFIC':
      return { ctr: 0.45, cpl: 0.05, cvr: 0.1, cpc: 0.4 };
    default: // AWARENESS, ENGAGEMENT
      return { ctr: 0.6, cpl: 0, cvr: 0, cpc: 0.4 };
  }
}

export function score(stats: AdStats, objective: string, peers: Peers): Score {
  const m = metrics(stats);
  const flags: string[] = [];

  // Money going out with nothing coming back is worth saying out loud even
  // when there is not enough data to grade.
  if (stats.spend > 0 && stats.leads === 0 && stats.impressions >= MIN_IMPRESSIONS) {
    flags.push('Spending with no leads yet');
  }
  if (stats.impressions >= MIN_IMPRESSIONS && (m.ctr ?? 0) < 0.5) {
    flags.push('Very few clicks for the impressions');
  }

  if (stats.impressions < MIN_IMPRESSIONS) {
    return {
      value: null,
      grade: null,
      reason: `Too little data to judge — ${stats.impressions.toLocaleString()} of ${MIN_IMPRESSIONS.toLocaleString()} impressions needed.`,
      flags,
    };
  }

  const w = weightsFor(objective);
  const parts: { key: keyof Peers; weight: number; value: number | null; lowerIsBetter: boolean }[] = [
    { key: 'ctr', weight: w.ctr, value: m.ctr, lowerIsBetter: false },
    { key: 'cpl', weight: w.cpl, value: m.cpl, lowerIsBetter: true },
    { key: 'cvr', weight: w.cvr, value: m.cvr, lowerIsBetter: false },
    { key: 'cpc', weight: w.cpc, value: m.cpc, lowerIsBetter: true },
  ];

  let total = 0;
  let used = 0;
  for (const p of parts) {
    if (p.weight === 0) continue;
    // No leads at all means the worst possible standing on the lead metrics,
    // not a skipped metric — otherwise a zero-lead ad scores as if it simply
    // was not measured.
    if (p.value === null) {
      if ((p.key === 'cpl' || p.key === 'cvr') && stats.clicks > 0) {
        total += 0;
        used += p.weight;
      }
      continue;
    }
    total += percentile(p.value, peers[p.key], p.lowerIsBetter) * p.weight;
    used += p.weight;
  }

  if (used === 0) {
    return { value: null, grade: null, reason: 'Not enough comparable data yet.', flags };
  }

  const value = Math.round((total / used) * 100);
  const grade = value >= 75 ? 'A' : value >= 50 ? 'B' : value >= 25 ? 'C' : 'D';

  // Say why, in the terms the money is actually spent in.
  const median = (arr: number[]) => {
    const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  };
  const reasons: string[] = [];
  const medCpl = median(peers.cpl);
  if (m.cpl !== null && medCpl) {
    const ratio = medCpl / m.cpl;
    reasons.push(
      ratio >= 1
        ? `Cost per lead ₱${m.cpl} — ${ratio.toFixed(1)}× cheaper than your median ₱${medCpl}`
        : `Cost per lead ₱${m.cpl} — ${(1 / ratio).toFixed(1)}× dearer than your median ₱${medCpl}`
    );
  }
  const medCtr = median(peers.ctr);
  if (m.ctr !== null && medCtr) {
    reasons.push(`Click rate ${m.ctr}% against your median ${medCtr}%`);
  }
  if (m.cpl === null && stats.clicks > 0) reasons.push('No leads from its clicks yet');

  return {
    value,
    grade,
    reason: reasons.join(' · ') || 'Scored against your other ads.',
    flags,
  };
}

// Build the comparison pool from a set of rows. Only rows with enough traffic
// count, so a handful of barely-run ads cannot drag the median around.
export function buildPeers(rows: AdStats[]): Peers {
  const eligible = rows.filter((r) => r.impressions >= MIN_IMPRESSIONS);
  const peers: Peers = { ctr: [], cpl: [], cvr: [], cpc: [] };
  for (const r of eligible) {
    const m = metrics(r);
    if (m.ctr !== null) peers.ctr.push(m.ctr);
    if (m.cpl !== null) peers.cpl.push(m.cpl);
    if (m.cvr !== null) peers.cvr.push(m.cvr);
    if (m.cpc !== null) peers.cpc.push(m.cpc);
  }
  return peers;
}
