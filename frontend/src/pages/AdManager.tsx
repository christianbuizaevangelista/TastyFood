import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, KpiCard } from '../components/ui';
import { peso, num } from '../lib/format';

// Campaign → ad set → ad, with a score on every level, split by brand.

type Grade = 'A' | 'B' | 'C' | 'D';
interface Score {
  value: number | null;
  grade: Grade | null;
  reason: string;
  flags: string[];
}
interface Metrics {
  ctr: number | null; cpc: number | null; cpl: number | null; cvr: number | null; cpm: number | null;
}
interface Ad {
  id: string; name: string; status: string; format: string | null;
  headline: string | null; primaryText: string | null; callToAction: string | null;
  spend: number; reach: number; impressions: number; clicks: number; leads: number;
  source: string; metrics: Metrics; score: Score;
}
interface AdSet {
  id: string; campaignId: string; name: string; status: string;
  budget: number; spend: number; reach: number; impressions: number; clicks: number; leads: number;
  ageMin: number | null; ageMax: number | null; genders: string | null;
  locations: string[]; interests: string[]; behaviours: string[]; placements: string[];
  audience: string | null; notes: string | null;
  metrics: Metrics; score: Score; ads: Ad[];
}
interface Campaign {
  id: string; name: string; brand: string; objective: string; status: string;
  budget: number; spend: number; reach: number; impressions: number; clicks: number; leads: number;
  source: string; metrics: Metrics; score: Score; adSets: AdSet[];
}
interface Best {
  id: string; name: string; campaign: string; adSet: string; brand: string;
  score: Score; metrics: Metrics; spend: number; leads: number;
}
interface Attention {
  id: string; name: string; campaign: string; adSet: string; spend: number; flags: string[];
}
interface Tree {
  campaigns: Campaign[];
  summary: { campaigns: number; adSets: number; ads: number; spend: number; leads: number; clicks: number; impressions: number } & Metrics;
  best: Best[]; worst: Best[]; attention: Attention[];
}
interface Preset {
  key: string; label: string; audience: string; goal: string;
  ageMin: number; ageMax: number; genders: string;
  locations: string[]; interests: string[]; behaviours: string[]; placements: string[];
  why: string; watchOut: string;
}
interface Brand { key: string; label: string; note: string }

const GRADE_STYLE: Record<Grade, string> = {
  A: 'bg-green-100 text-green-700 border-green-300',
  B: 'bg-lime-100 text-lime-700 border-lime-300',
  C: 'bg-amber-100 text-amber-700 border-amber-300',
  D: 'bg-red-100 text-red-700 border-red-300',
};
const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-slate-100 text-slate-500',
};

function ScoreBadge({ score }: { score: Score }) {
  if (score.value === null || !score.grade) {
    return (
      <span className="badge bg-slate-100 text-slate-400" title={score.reason}>
        not scored yet
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${GRADE_STYLE[score.grade]}`}
      title={score.reason}
    >
      {score.grade}
      <span className="font-normal opacity-70">{score.value}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-medium tabular-nums text-slate-700">{value}</div>
    </div>
  );
}

function StatRow({ m, spend, leads, impressions, clicks }: { m: Metrics; spend: number; leads: number; impressions: number; clicks: number }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6">
      <Stat label="Spend" value={peso(spend)} />
      <Stat label="Leads" value={num(leads)} />
      <Stat label="Cost/lead" value={m.cpl !== null ? peso(m.cpl) : '—'} />
      <Stat label="Click rate" value={m.ctr !== null ? `${m.ctr}%` : '—'} />
      <Stat label="Clicks" value={num(clicks)} />
      <Stat label="Shown" value={num(impressions)} />
    </div>
  );
}

export default function AdManager() {
  const [brand, setBrand] = useState('');
  const { data, loading, error, refetch } = useFetch<Tree>(
    `/marketing/ads${brand ? `?brand=${brand}` : ''}`
  );
  const meta = useFetch<{ brands: Brand[]; audiences: string[]; presets: Preset[] }>('/marketing/ads/targeting');
  const [err, setErr] = useState<string | null>(null);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  const brands = meta.data?.brands ?? [];
  const presets = meta.data?.presets ?? [];

  async function del(kind: 'sets' | 'ads', id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    setErr(null);
    try {
      await api.delete(`/marketing/ads/${kind}/${id}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const s = data?.summary;

  return (
    <div>
      <PageHeader
        title="Ad Manager"
        subtitle="Campaigns, ad sets and ads — scored against each other so you can see what is working"
      />

      {err && <Alert>{err}</Alert>}

      {/* Brand sections */}
      <div className="mb-5 flex flex-wrap gap-2">
        <button
          onClick={() => setBrand('')}
          className={`rounded-lg border px-3 py-2 text-sm transition ${
            brand === '' ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
          }`}
        >
          All brands
        </button>
        {brands.map((b) => (
          <button
            key={b.key}
            onClick={() => setBrand(b.key)}
            title={b.note}
            className={`rounded-lg border px-3 py-2 text-sm transition ${
              brand === b.key ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Spend" value={peso(s?.spend ?? 0)} hint={`${num(s?.campaigns ?? 0)} campaigns`} />
        <KpiCard label="Leads" value={num(s?.leads ?? 0)} accent="text-brand-600" hint={`${num(s?.ads ?? 0)} ads running`} />
        <KpiCard
          label="Cost per lead"
          value={s?.cpl !== null && s?.cpl !== undefined ? peso(s.cpl) : '—'}
          accent="text-green-600"
          hint="the number that decides the budget"
        />
        <KpiCard label="Click rate" value={s?.ctr !== null && s?.ctr !== undefined ? `${s.ctr}%` : '—'} hint={`${num(s?.clicks ?? 0)} clicks`} />
      </div>

      {/* What is winning and what is burning money */}
      {(data?.best.length || data?.attention.length) ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {data.best.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Your best ads right now</h3>
              <div className="space-y-3">
                {data.best.map((a, i) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <span className="mt-0.5 text-xs font-bold text-slate-300">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-slate-800">{a.name}</span>
                        <ScoreBadge score={a.score} />
                      </div>
                      <div className="text-xs text-slate-400">{a.campaign} › {a.adSet}</div>
                      <div className="mt-0.5 text-xs text-slate-600">{a.score.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
                Put more budget here before you write anything new.
              </p>
            </div>
          )}

          {data.attention.length > 0 && (
            <div className="card border-amber-200">
              <h3 className="mb-3 text-sm font-semibold text-amber-700">Needs a look</h3>
              <div className="space-y-3">
                {data.attention.slice(0, 5).map((a) => (
                  <div key={a.id}>
                    <div className="font-medium text-slate-800">{a.name}</div>
                    <div className="text-xs text-slate-400">{a.campaign} › {a.adSet} · {peso(a.spend)} spent</div>
                    <ul className="mt-0.5 list-disc pl-4 text-xs text-amber-700">
                      {a.flags.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Targeting library */}
      <div className="card mb-6">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowPresets(!showPresets)}
        >
          <span>
            <span className="text-sm font-semibold text-slate-700">Audience suggestions</span>
            <span className="ml-2 text-xs text-slate-400">
              {presets.length} starting points built for your products and tiers
            </span>
          </span>
          <span className="text-slate-400">{showPresets ? '▲' : '▼'}</span>
        </button>

        {showPresets && (
          <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
            {presets.map((p) => (
              <div key={p.key} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{p.label}</span>
                  <span className="badge bg-brand-50 text-brand-700">{p.audience}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{p.goal}</p>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Age &amp; gender</dt>
                    <dd className="text-slate-700">
                      {p.ageMin}–{p.ageMax} · {p.genders === 'ALL' ? 'all genders' : p.genders.toLowerCase()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Where</dt>
                    <dd className="text-slate-700">{p.locations.join('; ')}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Interests</dt>
                    <dd className="flex flex-wrap gap-1 pt-1">
                      {p.interests.map((i) => (
                        <span key={i} className="badge bg-slate-100 text-slate-600">{i}</span>
                      ))}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Behaviours &amp; placements</dt>
                    <dd className="flex flex-wrap gap-1 pt-1">
                      {[...p.behaviours, ...p.placements].map((i) => (
                        <span key={i} className="badge bg-slate-100 text-slate-600">{i}</span>
                      ))}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <strong className="text-slate-700">Why:</strong> {p.why}
                </p>
                <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <strong>Watch out:</strong> {p.watchOut}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The tree */}
      {!data || data.campaigns.length === 0 ? (
        <EmptyState>
          {brand ? 'No campaigns under this brand yet.' : 'No campaigns yet — create one in Facebook Ads, or sync from Meta.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {data.campaigns.map((c) => {
            const open = openCampaign === c.id;
            return (
              <div key={c.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="text-left font-semibold text-slate-800 hover:text-brand-700"
                        onClick={() => setOpenCampaign(open ? null : c.id)}
                      >
                        {open ? '▾' : '▸'} {c.name}
                      </button>
                      <ScoreBadge score={c.score} />
                      <span className={`badge ${STATUS_STYLE[c.status] ?? ''}`}>{c.status.toLowerCase()}</span>
                      <span className="badge bg-slate-100 text-slate-600">{c.objective.toLowerCase()}</span>
                      {c.source === 'FACEBOOK' && <span className="badge bg-blue-50 text-blue-700">synced</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {brands.find((b) => b.key === c.brand)?.label ?? c.brand} · {c.adSets.length} ad set
                      {c.adSets.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <StatRow m={c.metrics} spend={c.spend} leads={c.leads} impressions={c.impressions} clicks={c.clicks} />

                {open && (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    {c.adSets.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        No ad sets yet. An ad set is one audience with one budget — that is where targeting lives.
                      </p>
                    ) : (
                      c.adSets.map((st) => {
                        const sOpen = openSet === st.id;
                        return (
                          <div key={st.id} className="rounded-lg border border-slate-200 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                className="text-left text-sm font-semibold text-slate-800 hover:text-brand-700"
                                onClick={() => setOpenSet(sOpen ? null : st.id)}
                              >
                                {sOpen ? '▾' : '▸'} {st.name}
                              </button>
                              <ScoreBadge score={st.score} />
                              <span className={`badge ${STATUS_STYLE[st.status] ?? ''}`}>{st.status.toLowerCase()}</span>
                              {st.audience && <span className="badge bg-brand-50 text-brand-700">{st.audience}</span>}
                              <button
                                className="ml-auto text-xs text-red-600 hover:underline"
                                onClick={() => del('sets', st.id, st.name)}
                              >
                                delete
                              </button>
                            </div>

                            <div className="mt-1 text-xs text-slate-500">
                              {[
                                st.ageMin && st.ageMax ? `${st.ageMin}–${st.ageMax}` : null,
                                st.genders && st.genders !== 'ALL' ? st.genders.toLowerCase() : null,
                                st.locations.length ? st.locations.join(', ') : null,
                              ].filter(Boolean).join(' · ') || 'No targeting recorded'}
                            </div>
                            {st.interests.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {st.interests.map((i) => (
                                  <span key={i} className="badge bg-slate-100 text-slate-600">{i}</span>
                                ))}
                              </div>
                            )}

                            <StatRow m={st.metrics} spend={st.spend} leads={st.leads} impressions={st.impressions} clicks={st.clicks} />

                            {sOpen && (
                              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                                {st.ads.length === 0 ? (
                                  <p className="text-sm text-slate-400">No ads in this set yet.</p>
                                ) : (
                                  st.ads.map((ad) => (
                                    <div key={ad.id} className="rounded border border-slate-100 bg-slate-50 p-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium text-slate-800">{ad.name}</span>
                                        <ScoreBadge score={ad.score} />
                                        {ad.format && <span className="badge bg-white text-slate-500">{ad.format.toLowerCase()}</span>}
                                        <button
                                          className="ml-auto text-xs text-red-600 hover:underline"
                                          onClick={() => del('ads', ad.id, ad.name)}
                                        >
                                          delete
                                        </button>
                                      </div>
                                      {ad.headline && <div className="mt-1 text-sm text-slate-700">{ad.headline}</div>}
                                      <StatRow m={ad.metrics} spend={ad.spend} leads={ad.leads} impressions={ad.impressions} clicks={ad.clicks} />
                                      {ad.score.reason && (
                                        <p className="mt-2 text-xs text-slate-500">{ad.score.reason}</p>
                                      )}
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Scores compare each ad against everything else this account has run — not against invented industry
        averages. Anything under 500 impressions is left unscored, because there is nothing there to judge yet.
      </p>
    </div>
  );
}
