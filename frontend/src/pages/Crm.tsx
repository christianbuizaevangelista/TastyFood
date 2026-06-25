import { useMemo, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, Badge } from '../components/ui';
import { peso } from '../lib/format';
import { DATE_PRESETS, presetRange, DatePreset } from '../lib/datePresets';
import { exportPoPdf, exportSaleReceiptPdf } from '../lib/poPdf';
import { Org, OrgType } from '../types';

const PARENT_OF: Record<string, OrgType> = { PROVINCIAL: 'PRINCIPAL', CITY: 'PROVINCIAL', RESELLER: 'CITY' };
const LEVEL_OF: Record<string, string> = { PROVINCIAL: 'PROVINCE', CITY: 'CITY', RESELLER: 'BARANGAY' };
// A City may report to a Provincial OR directly to the Principal (when no
// Provincial is assigned yet). Its purchase orders always go to its parent.
const ALLOWED_PARENT_TYPES: Record<string, OrgType[]> = {
  PROVINCIAL: ['PRINCIPAL'],
  CITY: ['PROVINCIAL', 'PRINCIPAL'],
  RESELLER: ['CITY', 'PROVINCIAL', 'PRINCIPAL'],
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    prompt('Copy this link:', text);
    return false;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

const DOC_TYPES: { key: string; label: string }[] = [
  { key: 'VALID_ID', label: 'Valid ID' },
  { key: 'AGREEMENT', label: 'Agreement' },
  { key: 'APPLICATION_FORM', label: 'Application Form' },
  { key: 'OTHER', label: 'Other' },
];

interface OrgDoc {
  id: string;
  type: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

// Confidential paperwork the Principal keeps per account. The account itself
// never sees this — it's only rendered for Principal users in the CRM.
function OrgDocuments({ orgId }: { orgId: string }) {
  const { data, loading, error, refetch } = useFetch<{ documents: OrgDoc[] }>(`/orgs/${orgId}/documents`);
  const [type, setType] = useState('VALID_ID');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    setErr(null);
    if (!file) return setErr('Choose a file.');
    if (file.size > 4 * 1024 * 1024) return setErr('File too large (max 4 MB).');
    setBusy(true);
    try {
      await api.post(`/orgs/${orgId}/documents`, {
        type,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: await fileToDataUrl(file),
      });
      setFile(null);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function view(d: OrgDoc) {
    setErr(null);
    try {
      const res = await api.get(`/orgs/${orgId}/documents/${d.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function remove(d: OrgDoc) {
    if (!confirm(`Delete "${d.fileName}"?`)) return;
    setErr(null);
    try {
      await api.delete(`/orgs/${orgId}/documents/${d.id}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  const labelOf = (t: string) => DOC_TYPES.find((x) => x.key === t)?.label ?? t;
  const docs = data?.documents ?? [];

  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Documents <span className="font-normal normal-case text-slate-300">· confidential — visible to Tasty Food only</span>
      </div>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Type</label>
          <select className="input text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            {DOC_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <input type="file" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn-primary text-xs" disabled={busy || !file} onClick={upload}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : error ? (
        <Alert>{error}</Alert>
      ) : docs.length === 0 ? (
        <div className="rounded-lg border border-slate-100 p-3 text-sm text-slate-400">No documents uploaded yet.</div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-700">{d.fileName}</div>
                <div className="text-xs text-slate-400">{labelOf(d.type)} · {new Date(d.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => view(d)}>View</button>
                <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => remove(d)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Crm() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch<{ orgs: Org[] }>('/orgs?includeSelf=true');
  const [showOnboard, setShowOnboard] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Org | null>(null);
  const [editTarget, setEditTarget] = useState<Org | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Org | null>(null);

  const [query, setQuery] = useState('');

  const downstream = useMemo(
    () => (data?.orgs ?? []).filter((o) => o.id !== user!.org.id),
    [data, user]
  );

  // Quick search across person/business name, territory/area, tier, and parent.
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return downstream;
    return downstream.filter((o) =>
      [o.contactName, o.name, o.territory?.name, o.type, o.parent?.name]
        .some((v) => v && v.toLowerCase().includes(term))
    );
  }, [downstream, query]);

  // Deactivating needs the Principal's password; activating is direct.
  async function toggleActive(org: Org) {
    if (org.isActive) {
      setDeactivateTarget(org);
      return;
    }
    setActionErr(null);
    try {
      await api.post(`/orgs/${org.id}/activate`);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  // Which tiers can this role onboard? Principal can onboard any tier directly
  // (e.g. a Reseller with no City/Provincial in the area yet).
  const onboardTiers: OrgType[] =
    user!.role === 'PRINCIPAL' ? ['PROVINCIAL', 'CITY', 'RESELLER'] : user!.role === 'PROVINCIAL' ? ['RESELLER'] : [];

  return (
    <div>
      <PageHeader
        title="Distribution Network"
        subtitle="Manage your downstream distributors and resellers"
        action={
          onboardTiers.length > 0 ? (
            <button className="btn-primary" onClick={() => setShowOnboard(true)}>+ Onboard account</button>
          ) : null
        }
      />

      {actionErr && <div className="mb-4"><Alert>{actionErr}</Alert></div>}

      <div className="mb-3 flex items-center gap-2">
        <input
          className="input max-w-sm"
          placeholder="🔍 Search name or territory…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <span className="text-xs text-slate-400">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        )}
      </div>

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
            {filtered.map((o) => (
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
            {!filtered.length && (
              <tr><td className="td text-slate-400" colSpan={8}>
                {downstream.length ? 'No accounts match your search.' : 'No downstream accounts yet.'}
              </td></tr>
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
          orgs={data?.orgs ?? []}
          canManage={user!.role === 'PRINCIPAL'}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            refetch();
          }}
        />
      )}

      {deactivateTarget && (
        <DeactivateAccount
          org={deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          onDone={() => {
            setDeactivateTarget(null);
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

function DeactivateAccount({ org, onClose, onDone }: { org: Org; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/orgs/${org.id}/deactivate`, { password });
      onDone();
    } catch (e) {
      setErr(apiError(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold text-red-700">Deactivate account</h2>
        <p className="mb-3 text-sm text-slate-600">
          Block <span className="font-semibold">{org.name}</span> from logging in and transacting. You can reactivate it later.
          Enter your password to confirm.
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
            {busy ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </div>
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
  orgs,
  canManage,
  onClose,
  onSaved,
}: {
  org: Org;
  orgs: Org[];
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
    salesTarget: String(org.salesTarget ?? 0),
    territoryId: org.territory?.id ?? '',
    parentId: org.parent?.id ?? '',
  });

  // Any downstream account's supplier can be reassigned up the allowed chain
  // (e.g. a Reseller → City, or Provincial, or directly the Principal).
  const allowedParents = ALLOWED_PARENT_TYPES[org.type] ?? [];
  const canReassign = canManage && allowedParents.length > 0;
  const supplierOptions = orgs.filter((o) => allowedParents.includes(o.type));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<{ kind: string; id: string } | null>(null);

  const level = LEVEL_OF[org.type];
  const vacant = useFetch<{ vacant: { id: string; name: string; level: string; parentName: string | null }[] }>(
    `/territories/vacant?level=${level}`
  );
  // Total Sales date filter.
  const [preset, setPreset] = useState<DatePreset>('all');
  const [range, setRange] = useState({ from: '', to: '' });
  const ordersUrl =
    `/orgs/${org.id}/orders` + (range.from || range.to ? `?from=${range.from}&to=${range.to}` : '');
  const orders = useFetch<{ purchases: OrderRow[]; sales: OrderRow[]; salesTotal: number; salesCount: number }>(
    ordersUrl,
    [ordersUrl]
  );
  function applyPreset(p: DatePreset) {
    setPreset(p);
    const r = presetRange(p);
    if (r) setRange(r);
  }

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
        salesTarget: form.salesTarget ? Number(form.salesTarget) : 0,
        territoryId: form.territoryId || null,
        ...(canReassign && form.parentId ? { parentId: form.parentId } : {}),
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
    <>
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
            {canReassign && (
              <div>
                <label className="label">Supplier (reports to)</label>
                <select className="input" value={form.parentId} onChange={set('parentId')}>
                  {supplierOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}{o.type === 'PRINCIPAL' ? ' (direct)' : ` (${o.type})`}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">Their purchase orders &amp; email notifications go to whoever is set here. If no City/Provincial yet, point them higher (up to the Principal).</p>
              </div>
            )}
            <div>
              <label className="label">Monthly sales target (₱)</label>
              <input className="input" type="number" min={0} value={form.salesTarget} onChange={set('salesTarget')} disabled={!canManage} />
              <p className="mt-1 text-xs text-slate-400">Shows as % attainment in KPI &amp; Leaderboards and their Dashboard.</p>
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

          {/* Right column: Total Sales + Purchase history */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Total Sales</div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-brand-600">{peso(orders.data?.salesTotal ?? 0)}</span>
                <span className="text-xs text-slate-400">{orders.data?.salesCount ?? 0} sale{(orders.data?.salesCount ?? 0) === 1 ? '' : 's'}</span>
              </div>
              <select className="input mt-2 text-sm" value={preset} onChange={(e) => applyPreset(e.target.value as DatePreset)}>
                {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              {preset === 'custom' && (
                <div className="mt-2 flex items-center gap-2">
                  <input type="date" className="input text-xs" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                  <span className="text-xs text-slate-400">to</span>
                  <input type="date" className="input text-xs" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
                </div>
              )}
            </div>

            <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Purchase history</div>
            {orders.loading ? (
              <div className="text-sm text-slate-400">Loading…</div>
            ) : history.length === 0 ? (
              <div className="rounded-lg border border-slate-100 p-3 text-sm text-slate-400">No orders yet.</div>
            ) : (
              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {history.map((h) => (
                  <div key={`${h.kind}-${h.id}`} className="rounded-lg border border-slate-100 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <button className="font-mono text-xs text-brand-700 hover:underline" onClick={() => setDetail({ kind: h.kind, id: h.id })}>
                        {h.number}
                      </button>
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

        {canManage && <OrgDocuments orgId={org.id} />}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          {canManage && (
            <button className="btn-primary" disabled={busy || !form.name} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
          )}
        </div>
      </div>
    </div>
    {detail && <OrderDetail kind={detail.kind} id={detail.id} onClose={() => setDetail(null)} />}
    </>
  );
}

function OrderDetail({ kind, id, onClose }: { kind: string; id: string; onClose: () => void }) {
  const isSale = kind === 'Sale';
  const { data, loading, error } = useFetch<any>(isSale ? `/sales/${id}` : `/purchase-orders/${id}`);

  const lines: { sku: string; name: string; quantity: number; unitPrice: number; lineTotal: number }[] = data
    ? isSale
      ? data.lines
      : data.items.map((it: any) => ({ sku: it.product.sku, name: it.product.name, quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.lineTotal }))
    : [];

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <Spinner />
        ) : error ? (
          <Alert>{error}</Alert>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{data.number}</h2>
                <p className="text-xs text-slate-500">
                  {isSale ? 'Sales Receipt' : 'Purchase Order'} · {new Date(data.createdAt).toLocaleString()}
                </p>
              </div>
              {data.status && <Badge value={data.status} />}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
              {isSale ? (
                <>
                  <div><div className="font-semibold text-slate-400">SELLER</div>{data.seller?.name}</div>
                  <div><div className="font-semibold text-slate-400">CUSTOMER</div>{data.customerName ?? 'Walk-in'}{data.customerEmail ? <div className="text-slate-400">{data.customerEmail}</div> : null}</div>
                </>
              ) : (
                <>
                  <div><div className="font-semibold text-slate-400">SUPPLIER</div>{data.sellerOrg?.name}</div>
                  <div><div className="font-semibold text-slate-400">CUSTOMER</div>{data.buyerOrg?.name}</div>
                </>
              )}
            </div>

            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="td">Product</th>
                  <th className="td text-right">Qty</th>
                  <th className="td text-right">Unit</th>
                  <th className="td text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="td"><div>{l.name}</div><div className="font-mono text-xs text-slate-400">{l.sku}</div></td>
                    <td className="td text-right">{l.quantity}</td>
                    <td className="td text-right">{peso(l.unitPrice)}</td>
                    <td className="td text-right">{peso(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 text-right text-sm">
              <div className="text-slate-500">Subtotal: {peso(data.subtotal)}</div>
              <div className="text-lg font-bold">{isSale ? 'Grand Total' : 'Total'}: {peso(data.total)}</div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Close</button>
              <button className="btn-primary" onClick={() => (isSale ? exportSaleReceiptPdf(data) : exportPoPdf(data))}>
                Export PDF
              </button>
            </div>
          </>
        )}
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

  // Valid suppliers = in-scope orgs whose tier is an allowed parent for this type.
  // (A City can pick the Principal directly, or a Provincial.)
  const allowedParentTypes = ALLOWED_PARENT_TYPES[type] ?? [];
  const parentOptions = scopeOrgs.filter(
    (o) =>
      allowedParentTypes.includes(o.type) &&
      (o.type !== 'PRINCIPAL' || (o.id === user!.org.id && user!.role === 'PRINCIPAL'))
  );

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
        <p className="mb-4 text-xs text-slate-500">Accounts go live immediately — no approval needed. The admin gets an email invite to set their own password.</p>
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
            <label className="label">Reports to / supplier</label>
            <select className="input" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">Select…</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}{o.type === 'PRINCIPAL' ? ' (direct)' : ` (${o.type})`}</option>
              ))}
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
            <label className="label">Monthly sales target (₱)</label>
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
