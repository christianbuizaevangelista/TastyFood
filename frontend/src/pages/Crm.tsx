import { useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, Badge } from '../components/ui';
import { peso } from '../lib/format';
import { Org, OrgType } from '../types';

const PARENT_OF: Record<string, OrgType> = { PROVINCIAL: 'PRINCIPAL', CITY: 'PROVINCIAL', RESELLER: 'CITY' };
const LEVEL_OF: Record<string, string> = { PROVINCIAL: 'PROVINCE', CITY: 'CITY', RESELLER: 'BARANGAY' };

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    prompt('Copy this link:', text);
    return false;
  }
}

export default function Crm() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch<{ orgs: Org[] }>('/orgs?includeSelf=true');
  const [showOnboard, setShowOnboard] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Org | null>(null);
  const [editTarget, setEditTarget] = useState<Org | null>(null);

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
                <td className="td">
                  <button className="text-left" onClick={() => setEditTarget(o)}>
                    <div className="font-medium text-brand-700 hover:underline">{o.contactName || o.name}</div>
                    <div className="text-xs font-normal text-slate-400">
                      {o.name}{o.territory ? ` · 📍 ${o.territory.name}` : ''}
                    </div>
                  </button>
                </td>
                <td className="td text-xs">{o.type}</td>
                <td className="td text-xs text-slate-500">{o.parent?.name ?? '—'}</td>
                <td className="td text-xs">
                  {o.contactPhone && <div>{o.contactPhone}</div>}
                  {o.contactEmail && <div className="text-slate-400">{o.contactEmail}</div>}
                </td>
                <td className="td text-right">{peso(o.salesTarget)}</td>
                <td className="td">
                  <Badge value={o.status} />
                  {o.pendingInvite && <div className="mt-1"><span className="badge bg-amber-100 text-amber-700">Pending password</span></div>}
                </td>
                <td className="td"><Badge value={o.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                <td className="td text-right">
                  {user!.role === 'PRINCIPAL' && (
                    <span className="flex justify-end gap-3">
                      <button
                        className={`text-xs font-semibold ${o.isActive ? 'text-red-600' : 'text-green-600'} hover:underline`}
                        onClick={() => toggleActive(o)}
                      >
                        {o.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="text-xs font-semibold text-red-700 hover:underline" onClick={() => setDeleteTarget(o)}>
                        Delete
                      </button>
                    </span>
                  )}
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

      {editTarget && (
        <EditAccount
          org={editTarget}
          canManage={user!.role === 'PRINCIPAL'}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            refetch();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteAccount
          org={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

interface OrderRow {
  id: string;
  number: string;
  status?: string;
  channel?: string;
  total: number;
  distributionType: string;
  createdAt: string;
}

function EditAccount({
  org,
  canManage,
  onClose,
  onSaved,
}: {
  org: Org;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: org.name,
    contactName: org.contactName ?? '',
    contactPhone: org.contactPhone ?? '',
    contactEmail: org.contactEmail ?? '',
    address: org.address ?? '',
    territoryId: org.territory?.id ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const level = LEVEL_OF[org.type];
  const vacant = useFetch<{ vacant: { id: string; name: string; level: string; parentName: string | null }[] }>(
    `/territories/vacant?level=${level}`
  );
  const orders = useFetch<{ purchases: OrderRow[]; sales: OrderRow[] }>(`/orgs/${org.id}/orders`);

  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.patch(`/orgs/${org.id}`, {
        name: form.name,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        contactEmail: form.contactEmail || undefined,
        address: form.address || undefined,
        territoryId: form.territoryId || null,
      });
      onSaved();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  async function getInviteLink() {
    setErr(null);
    try {
      const { data } = await api.get(`/orgs/${org.id}/invite-link`);
      setLink(data.inviteLink);
      const ok = await copyToClipboard(data.inviteLink);
      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
    } catch (e) {
      setErr(apiError(e));
    }
  }

  const history = [
    ...(orders.data?.purchases ?? []).map((p) => ({ ...p, kind: 'Purchase' })),
    ...(orders.data?.sales ?? []).map((s) => ({ ...s, kind: 'Sale' })),
  ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{form.contactName || form.name}</h2>
        <p className="mb-4 text-xs text-slate-500">
          {org.name} · {org.type} · reports to {org.parent?.name ?? '—'}
        </p>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Customer details (editable) */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Customer details</div>
            <div>
              <label className="label">Contact person</label>
              <input className="input" value={form.contactName} onChange={set('contactName')} disabled={!canManage} />
            </div>
            <div>
              <label className="label">Business name</label>
              <input className="input" value={form.name} onChange={set('name')} disabled={!canManage} />
            </div>
            <div>
              <label className="label">Cellphone number</label>
              <input className="input" value={form.contactPhone} onChange={set('contactPhone')} disabled={!canManage} />
            </div>
            <div>
              <label className="label">Email address</label>
              <input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} disabled={!canManage} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={set('address')} disabled={!canManage} />
            </div>
            <div>
              <label className="label">Territory ({level})</label>
              <select className="input" value={form.territoryId} onChange={set('territoryId')} disabled={!canManage}>
                <option value="">Unassigned</option>
                {org.territory && <option value={org.territory.id}>{org.territory.name} (current)</option>}
                {vacant.data?.vacant.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.parentName ? ` — ${t.parentName}` : ''}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">Assigning a territory adds this account to the Org Structure map.</p>
            </div>

            {org.pendingInvite && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="mb-1 text-xs font-semibold text-amber-700">Admin hasn't set their password yet</div>
                <button type="button" className="btn-ghost text-xs" onClick={getInviteLink}>
                  {copied ? 'Link copied!' : 'Copy invite link'}
                </button>
                {link && <input className="input mt-2 font-mono text-xs" readOnly value={link} onFocus={(e) => e.target.select()} />}
              </div>
            )}
          </div>

          {/* Purchase history */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Purchase history</div>
            {orders.loading ? (
              <div className="text-sm text-slate-400">Loading…</div>
            ) : history.length === 0 ? (
              <div className="rounded-lg border border-slate-100 p-3 text-sm text-slate-400">No orders yet.</div>
            ) : (
              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {history.map((h) => (
                  <div key={`${h.kind}-${h.id}`} className="rounded-lg border border-slate-100 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{h.number}</span>
                      <span className="font-semibold">{peso(h.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                      <span>{new Date(h.createdAt).toLocaleDateString()} · {h.kind}</span>
                      {h.status && <Badge value={h.status} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          {canManage && (
            <button className="btn-primary" disabled={busy || !form.name} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteAccount({ org, onClose, onDeleted }: { org: Org; onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setErr(null);
    setBusy(true);
    try {
      await api.delete(`/orgs/${org.id}`, { data: { password } });
      onDeleted();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold text-red-700">Delete account</h2>
        <p className="mb-3 text-sm text-slate-600">
          Remove <span className="font-semibold">{org.name}</span> from the CRM and Org Structure, and block its login.
          Its past records (sales, orders) are kept for reporting. Enter your account password to confirm.
        </p>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}
        <label className="label">Your password</label>
        <input
          className="input"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && password && confirm()}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary bg-red-600 hover:bg-red-700" disabled={busy || !password} onClick={confirm}>
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>
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
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ inviteLink: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

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
      const { data } = await api.post('/orgs', {
        name: form.name,
        type,
        parentId: form.parentId,
        territoryId: form.territoryId || undefined,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        address: form.address || undefined,
        salesTarget: form.salesTarget ? Number(form.salesTarget) : undefined,
        // No password — the admin gets an email invite to set their own.
        admin: { name: form.adminName, email: form.adminEmail },
      });
      setCreated({ inviteLink: data.inviteLink ?? null });
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
        <p className="mb-4 text-xs text-slate-500">New accounts start as PENDING and require approval. The admin gets an email invite to set their own password.</p>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}

        {!created && (
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
        </div>
        )}

        {created && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="text-sm font-semibold text-green-800">Account created 🎉</div>
            <p className="mt-1 text-xs text-green-700">
              An email invite was sent to {form.adminEmail} so they can set their own password.
              If it doesn't arrive, copy the link below and send it to them.
            </p>
            {created.inviteLink && (
              <div className="mt-3 flex items-center gap-2">
                <input className="input flex-1 font-mono text-xs" readOnly value={created.inviteLink} onFocus={(e) => e.target.select()} />
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={async () => { const ok = await copyToClipboard(created.inviteLink!); if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {created ? (
            <button className="btn-primary" onClick={onCreated}>Done</button>
          ) : (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn-primary"
                disabled={busy || !form.name || !form.parentId || !form.adminName || !form.adminEmail}
                onClick={submit}
              >
                {busy ? 'Creating…' : 'Create account'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
