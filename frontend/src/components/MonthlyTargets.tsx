import { useEffect, useState } from 'react';
import { api, apiError } from '../api/client';
import { Alert, Spinner } from './ui';
import { peso } from '../lib/format';

// Sets a sales target per calendar month for one account. Demand is seasonal —
// a single yearly figure over-rewards weak months and under-rewards strong ones.
// A month left blank inherits the account's default target.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface MonthRow {
  month: number;
  custom: boolean;
  target: number;
  note: string | null;
}
interface TargetsResponse {
  org: { id: string; name: string; defaultTarget: number };
  year: number;
  months: MonthRow[];
}

export function MonthlyTargets({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<TargetsResponse | null>(null);
  const [rows, setRows] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load(y: number) {
    setLoading(true);
    setErr(null);
    try {
      const { data: d } = await api.get<TargetsResponse>(`/kpi/targets/${orgId}?year=${y}`);
      setData(d);
      // Only months deliberately set are pre-filled; the rest stay blank so it
      // is obvious which ones are inherited.
      const next: Record<number, string> = {};
      for (const m of d.months) next[m.month] = m.custom ? String(m.target) : '';
      setRows(next);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(year); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId, year]);

  async function save() {
    setSaving(true);
    setErr(null);
    setNote(null);
    try {
      const months = Object.entries(rows).map(([m, v]) => ({
        month: Number(m),
        target: v.trim() === '' ? null : Number(v),
      }));
      const bad = months.find((m) => m.target !== null && (!isFinite(m.target) || m.target < 0));
      if (bad) { setErr(`${MONTHS[bad.month - 1]} is not a valid amount.`); setSaving(false); return; }
      await api.put(`/kpi/targets/${orgId}`, { year, months });
      setNote('Targets saved.');
      load(year);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setSaving(false);
    }
  }

  const total = Object.values(rows).reduce((s, v) => s + (v.trim() === '' ? (data?.org.defaultTarget ?? 0) : Number(v) || 0), 0);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Monthly targets</h2>
            {data && <p className="text-sm text-slate-500">{data.org.name}</p>}
          </div>
          <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner />
        ) : !data ? (
          <Alert>{err ?? 'Could not load targets.'}</Alert>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-400">
              Leave a month blank to use the account's default of{' '}
              <strong>{peso(data.org.defaultTarget)}</strong>.
            </p>
            {err && <div className="mb-2"><Alert>{err}</Alert></div>}
            {note && <div className="mb-2"><Alert kind="success">{note}</Alert></div>}

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {data.months.map((m) => (
                <div key={m.month}>
                  <label className="mb-0.5 block text-xs font-medium text-slate-600">
                    {MONTHS[m.month - 1]}
                    {rows[m.month]?.trim() === '' && <span className="ml-1 text-slate-300">default</span>}
                  </label>
                  <input
                    className="input text-sm"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={String(data.org.defaultTarget)}
                    value={rows[m.month] ?? ''}
                    onChange={(e) => setRows((r) => ({ ...r, [m.month]: e.target.value }))}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-500">Year total: </span>
              <span className="font-semibold text-slate-800">{peso(total)}</span>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose} disabled={saving}>Close</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save targets'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
