import { useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, Badge } from '../components/ui';
import { peso } from '../lib/format';
import { Org, OrgType } from '../types';

const PARENT_OF: Record<string, OrgType> = { PROVINCIAL: 'PRINCIPAL', CITY: 'PROVINCIAL', RESELLER: 'CITY' };
const LEVEL_OF: Record<string, string> = { PROVINCIAL: 'PROVINCE', CITY: 'CITY', RESELLER: 'BARANGAY' };

export default function Crm() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch<{ orgs: Org[] }>('/orgs?includeSelf=true');
  const [showOnboard, setShowOnboard] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const downstream = useMemo(
    () => (data?.orgs ?? []).filter((o) => o.id !== user!.org.id),
    [data, user]
  );

  async function toggleActive(org: Org) {
    setActionErr(null);
    try {
      await api.post(`/orgs/${org.id}/${org.isActive ? 'deactivate' : 'activate'}`);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  // Which tiers can this role onboard?
  const onboardTiers: OrgType[] =
    user!.role === 'PRINCIPAL' ? ['PROVINCIAL', 'CITY'] : user!.role === 'PROVINCIAL' ? ['RESELLER'] : [];

  return (
    <div>
      <PageHeader
        title="CRM / Accounts"
        subtitle="Manage your downstream distribution accounts"
        action={
          onboardTiers.length > 0 ? (
            <button className="btn-primary" onClick={() => setShowOnboard(true)}>+ Onboard account</button>
          ) : null
        }
      />

      {actionErr && <div className="mb-4"><Alert>{actionErr}</Alert></div>}

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">Name</th>
              <th className="th">Tier</th>
              <th className="th">Reports to</th>
              <th className="th">Contact</th>
              <th className="th text-right">Target</th>
              <th className="th">Approval</th>
              <th className="th">Membership</th>
              <th className="th text-right"></th>
            </tr>
          </thead>
          <tbody>
            {downstream.map((o) => (
              <tr key={o.id} className="border-b border-slate-50">
                <td className="td font-medium">{o.name}</td>
                <td className="td text-xs">{o.type}</td>
                <td className="td text-xs text-slate-500">{o.parent?.name ?? '—'}</td>
                <td className="td text-xs">
                  {o.contactName}
                  {o.contactPhone && <div className="text-slate-400">{o.contactPhone}</div>}
                </td>
                <td className="td text-right">{peso(o.salesTarget)}</td>
                <td className="td"><Badge value={o.status} /></td>
                <td className="td"><Badge value={o.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                <td className="td text-right">
                  {user!.role !== 'CITY' || o.type === 'RESELLER' ? (
                    <button
                      className={`text-xs font-semibold ${o.isActive ? 'text-red-600' : 'text-green-600'} hover:underline`}
                      onClick={() => toggleActive(o)}
                    >
                      {o.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!downstream.length && (
              <tr><td className="td text-slate-400" colSpan={8}>No downstream accounts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showOnboard && (
        <Onboard
          tiers={onboardTiers}
          scopeOrgs={data?.orgs ?? []}
          onClose={() => setShowOnboard(false)}
          onCreated={() => {
            setShowOnboard(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function Onboard({
  tiers,
  scopeOrgs,
  onClose,
  onCreated,
}: {
  tiers: OrgType[];
  scopeOrgs: Org[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [type, setType] = useState<OrgType>(tiers[0]);
  const [form, setForm] = useState({
    name: '',
    parentId: '',
    territoryId: '',
    contactName: '',
    contactPhone: '',
    address: '',
    salesTarget: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Vacant territories of the level this position occupies, within scope.
  const vacant = useFetch<{ vacant: { id: string; name: string; level: string; parentName: string | null }[] }>(
    `/territories/vacant?level=${LEVEL_OF[type]}`,
    [type]
  );

  // Valid parents = in-scope orgs of the required parent tier.
  const parentTier = PARENT_OF[type];
  const parentOptions =
    parentTier === 'PRINCIPAL'
      ? scopeOrgs.filter((o) => o.id === user!.org.id && user!.role === 'PRINCIPAL')
      : scopeOrgs.filter((o) => o.type === parentTier);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await api.post('/orgs', {
        name: form.name,
        type,
        parentId: form.parentId,
        territoryId: form.territoryId || undefined,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        address: form.address || undefined,
        salesTarget: form.salesTarget ? Number(form.salesTarget) : undefined,
        admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword },
      });
      onCreated();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">Onboard account</h2>
        <p className="mb-4 text-xs text-slate-500">New accounts start as PENDING and require approval before they can transact.</p>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Tier</label>
            <select className="input" value={type} onChange={(e) => { setType(e.target.value as OrgType); setForm({ ...form, parentId: '', territoryId: '' }); }}>
              {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Reports to ({parentTier})</label>
            <select className="input" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">Select…</option>
              {parentOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Territory to assign ({LEVEL_OF[type]})</label>
            <select className="input" value={form.territoryId} onChange={(e) => setForm({ ...form, territoryId: e.target.value })}>
              <option value="">{vacant.loading ? 'Loading…' : 'Unassigned (assign later)'}</option>
              {vacant.data?.vacant.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.parentName ? ` — ${t.parentName}` : ''}
                </option>
              ))}
            </select>
            {!vacant.loading && (vacant.data?.vacant.length ?? 0) === 0 && (
              <p className="mt-1 text-xs text-amber-600">No vacant {LEVEL_OF[type]} territory available in your scope.</p>
            )}
          </div>
          <div className="col-span-2">
            <label className="label">Business name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Contact name</label>
            <input className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Sales target (₱)</label>
            <input className="input" type="number" value={form.salesTarget} onChange={(e) => setForm({ ...form, salesTarget: e.target.value })} />
          </div>

          <div className="col-span-2 mt-2 border-t border-slate-100 pt-3 text-xs font-semibold uppercase text-slate-400">Login for the account admin</div>
          <div>
            <label className="label">Admin name</label>
            <input className="input" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
          </div>
          <div>
            <label className="label">Admin email</label>
            <input className="input" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Temp password (min 6 chars)</label>
            <input className="input" type="text" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create account'}</button>
        </div>
      </div>
    </div>
  );
}
