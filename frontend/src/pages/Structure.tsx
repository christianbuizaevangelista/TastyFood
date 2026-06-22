import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard, Badge } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

type Level = 'REGION' | 'PROVINCE' | 'CITY' | 'BARANGAY';

interface TNode {
  id: string;
  name: string;
  level: Level;
  vacant: boolean;
  assignedOrg: { id: string; name: string; type: string; status: string } | null;
  children: TNode[];
}
interface StructureData {
  tree: TNode[];
  summary: { vacant: Record<string, number>; total: Record<string, number> };
}

const LEVEL_META: Record<string, { icon: string; role: string; accent: string; label: string }> = {
  REGION: { icon: '🌏', role: 'Principal coverage', accent: 'border-slate-400 bg-slate-50', label: 'Region' },
  PROVINCE: { icon: '🏛️', role: 'Provincial Distributor', accent: 'border-brand-400 bg-brand-50', label: 'Province' },
  CITY: { icon: '🏙️', role: 'City Distributor', accent: 'border-sky-400 bg-sky-50', label: 'City / Municipality' },
  BARANGAY: { icon: '🏠', role: 'Reseller', accent: 'border-violet-400 bg-violet-50', label: 'Barangay' },
};
const CHILD: Record<string, { level: Level; label: string } | null> = {
  REGION: { level: 'PROVINCE', label: 'Province' },
  PROVINCE: { level: 'CITY', label: 'City / Municipality' },
  CITY: { level: 'BARANGAY', label: 'Barangay' },
  BARANGAY: null,
};
const PARENT_LEVEL: Record<Level, Level | null> = { REGION: null, PROVINCE: 'REGION', CITY: 'PROVINCE', BARANGAY: 'CITY' };
const TYPE_FOR_LEVEL: Record<string, string> = { PROVINCE: 'PROVINCIAL', CITY: 'CITY', BARANGAY: 'RESELLER' };

function countVacant(node: TNode): number {
  let n = node.level !== 'REGION' && node.vacant ? 1 : 0;
  for (const c of node.children) n += countVacant(c);
  return n;
}
function nodesOfLevel(tree: TNode[], level: Level): TNode[] {
  const out: TNode[] = [];
  const walk = (n: TNode) => {
    if (n.level === level) out.push(n);
    n.children.forEach(walk);
  };
  tree.forEach(walk);
  return out;
}

interface Actions {
  canManage: boolean;
  onAddChild: (parent: TNode) => void;
  onRename: (node: TNode) => void;
  onDelete: (node: TNode) => void;
  onAddMember: (node: TNode, orgParentId: string | null) => void;
  onRemoveMember: (node: TNode) => void;
  onDetails: (orgId: string) => void;
  principalOrgId: string;
}

function Node({
  node,
  depth,
  actions,
  parentOrgId,
}: {
  node: TNode;
  depth: number;
  actions: Actions;
  parentOrgId: string | null;
}) {
  const [open, setOpen] = useState(depth === 0);
  const meta = LEVEL_META[node.level];
  const hasChildren = node.children.length > 0;
  const child = CHILD[node.level];
  const assignable = node.level !== 'REGION';

  // Org-parent for a new member here: Province -> Principal; City/Barangay -> the org in the parent territory.
  const orgParentId = node.level === 'PROVINCE' ? actions.principalOrgId : parentOrgId;
  const canAddMember = assignable && !node.assignedOrg && !!orgParentId;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-50 py-2 hover:bg-slate-50" style={{ paddingLeft: `${depth * 1.5}rem` }}>
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-2 text-left">
          <span className="w-4 text-xs text-slate-400">{hasChildren ? (open ? '▼' : '▶') : ''}</span>
          <span className={`flex h-7 w-7 items-center justify-center rounded-md border-l-4 ${meta.accent}`}>{meta.icon}</span>
          <span className={node.level === 'REGION' ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}>{node.name}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{meta.label}</span>
        </button>

        <div className="flex items-center gap-2">
          {node.level === 'REGION' ? (
            <span className="text-xs text-slate-400">{countVacant(node)} vacant inside</span>
          ) : node.assignedOrg ? (
            <span className="flex items-center gap-1 text-xs text-slate-600">
              <button
                onClick={() => actions.onDetails(node.assignedOrg!.id)}
                className="font-semibold text-brand-600 hover:underline"
                title="View member details"
              >
                {node.assignedOrg.name}
              </button>
              <Badge value={node.assignedOrg.status} />
              {actions.canManage && (
                <button onClick={() => actions.onRemoveMember(node)} className="rounded px-1 font-semibold text-red-600 hover:bg-red-50" title="Remove member">Remove</button>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="badge bg-amber-100 text-amber-700">VACANT · {meta.role}</span>
              {actions.canManage && assignable && (
                <button
                  onClick={() => actions.onAddMember(node, orgParentId)}
                  disabled={!canAddMember}
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-40"
                  title={canAddMember ? 'Add member' : 'Assign the parent area first'}
                >
                  + Member
                </button>
              )}
            </span>
          )}

          {actions.canManage && (
            <span className="flex items-center gap-1">
              {child && (
                <button onClick={() => actions.onAddChild(node)} className="rounded px-1.5 py-0.5 text-xs font-semibold text-brand-600 hover:bg-brand-50" title={`Add ${child.label}`}>
                  + {child.label}
                </button>
              )}
              <button onClick={() => actions.onRename(node)} className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100" title="Rename">✎</button>
              <button onClick={() => actions.onDelete(node)} className="rounded px-1 text-xs text-red-500 hover:bg-red-50" title="Delete area">🗑</button>
            </span>
          )}
        </div>
      </div>

      {open &&
        node.children.map((c) => (
          <Node key={c.id} node={c} depth={depth + 1} actions={actions} parentOrgId={node.assignedOrg?.id ?? null} />
        ))}
    </div>
  );
}

interface TerritoryModal {
  mode: 'add' | 'rename';
  level: Level;
  label: string;
  parentId?: string;
  parentName?: string;
  parentOptions?: { id: string; name: string }[];
  target?: TNode;
}
interface MemberModal {
  node: TNode;
  orgParentId: string;
  type: string;
}

export default function Structure() {
  const { user } = useAuth();
  const canManage = user!.role === 'PRINCIPAL';
  const { data, loading, error, refetch } = useFetch<StructureData>('/territories');

  const [tModal, setTModal] = useState<TerritoryModal | null>(null);
  const [name, setName] = useState('');
  const [parentPick, setParentPick] = useState('');
  const [provincePick, setProvincePick] = useState('');
  const [memberModal, setMemberModal] = useState<MemberModal | null>(null);
  const [detailsOrgId, setDetailsOrgId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const tree = data?.tree ?? [];

  function openAddTerritory(level: Level) {
    setName('');
    setParentPick('');
    setProvincePick('');
    setActionErr(null);
    const parentLevel = PARENT_LEVEL[level];
    const parentOptions = parentLevel ? nodesOfLevel(tree, parentLevel).map((n) => ({ id: n.id, name: n.name })) : undefined;
    setTModal({ mode: 'add', level, label: LEVEL_META[level].label, parentOptions });
  }
  function openAddChild(parent: TNode) {
    const child = CHILD[parent.level];
    if (!child) return;
    setName('');
    setActionErr(null);
    setTModal({ mode: 'add', level: child.level, label: child.label, parentId: parent.id, parentName: parent.name });
  }
  function openRename(node: TNode) {
    setName(node.name);
    setActionErr(null);
    setTModal({ mode: 'rename', level: node.level, label: LEVEL_META[node.level].label, target: node });
  }
  async function onDelete(node: TNode) {
    if (!window.confirm(`Delete area "${node.name}"? It must be empty and unassigned.`)) return;
    setActionErr(null);
    try {
      await api.delete(`/territories/${node.id}`);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    }
  }
  async function onRemoveMember(node: TNode) {
    if (!window.confirm(`Remove ${node.assignedOrg?.name} from ${node.name}? It becomes vacant.`)) return;
    setActionErr(null);
    try {
      await api.post(`/territories/${node.id}/unassign`);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    }
  }
  function onAddMember(node: TNode, orgParentId: string | null) {
    if (!orgParentId) return;
    setActionErr(null);
    setMemberModal({ node, orgParentId, type: TYPE_FOR_LEVEL[node.level] });
  }

  async function submitTerritory() {
    if (!tModal || !name.trim()) return;
    setBusy(true);
    setActionErr(null);
    try {
      if (tModal.mode === 'add') {
        const parentId = tModal.parentId ?? (parentPick || undefined);
        if (tModal.level !== 'REGION' && !parentId) {
          setActionErr('Please select the parent area.');
          setBusy(false);
          return;
        }
        await api.post('/territories', { name: name.trim(), level: tModal.level, parentId });
      } else if (tModal.target) {
        await api.patch(`/territories/${tModal.target.id}`, { name: name.trim() });
      }
      setTModal(null);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const actions: Actions = {
    canManage,
    onAddChild: openAddChild,
    onRename: openRename,
    onDelete,
    onAddMember,
    onRemoveMember,
    onDetails: setDetailsOrgId,
    principalOrgId: user!.org.id,
  };

  return (
    <div>
      <PageHeader
        title="Organization Structure"
        subtitle={canManage ? 'Encode areas and manage their members.' : 'Your territory and the locations beneath it.'}
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => openAddTerritory('REGION')}>+ Region</button>
              <button className="btn-ghost" onClick={() => openAddTerritory('PROVINCE')}>+ Province</button>
              <button className="btn-ghost" onClick={() => openAddTerritory('CITY')}>+ City/Municipality</button>
              <button className="btn-ghost" onClick={() => openAddTerritory('BARANGAY')}>+ Barangay</button>
            </div>
          ) : undefined
        }
      />

      {actionErr && <div className="mb-4"><Alert>{actionErr}</Alert></div>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Vacant Provinces" value={`${data.summary.vacant.PROVINCE} / ${data.summary.total.PROVINCE}`} hint="Provincial Distributor" accent={data.summary.vacant.PROVINCE ? 'text-amber-600' : 'text-slate-900'} />
        <KpiCard label="Vacant Cities/Municipalities" value={`${data.summary.vacant.CITY} / ${data.summary.total.CITY}`} hint="City Distributor" accent={data.summary.vacant.CITY ? 'text-amber-600' : 'text-slate-900'} />
        <KpiCard label="Vacant Barangays" value={`${data.summary.vacant.BARANGAY} / ${data.summary.total.BARANGAY}`} hint="Reseller" accent={data.summary.vacant.BARANGAY ? 'text-amber-600' : 'text-slate-900'} />
      </div>

      <div className="card">
        {tree.length === 0 ? (
          <p className="text-sm text-slate-400">{canManage ? 'No areas yet. Use the buttons above to start encoding.' : 'No territory assigned to your account yet.'}</p>
        ) : (
          tree.map((n) => <Node key={n.id} node={n} depth={0} actions={actions} parentOrgId={null} />)
        )}
      </div>

      {/* Add/Rename territory */}
      {tModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={() => setTModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold">{tModal.mode === 'add' ? `Add ${tModal.label}` : `Rename ${tModal.label}`}</h2>
            {actionErr && <div className="mb-3"><Alert>{actionErr}</Alert></div>}
            {tModal.mode === 'add' && tModal.parentName && <p className="mb-3 text-xs text-slate-500">Under: {tModal.parentName}</p>}
            {tModal.mode === 'add' && tModal.parentOptions && tModal.level === 'BARANGAY' ? (
              // Cascade: pick Province first, then its City/Municipality.
              <>
                <div className="mb-3">
                  <label className="label">Province</label>
                  <select
                    className="input"
                    value={provincePick}
                    onChange={(e) => { setProvincePick(e.target.value); setParentPick(''); }}
                  >
                    <option value="">Select province…</option>
                    {nodesOfLevel(tree, 'PROVINCE').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="mb-3">
                  <label className="label">City / Municipality</label>
                  <select className="input" value={parentPick} disabled={!provincePick} onChange={(e) => setParentPick(e.target.value)}>
                    <option value="">{provincePick ? 'Select city/municipality…' : 'Select province first'}</option>
                    {(nodesOfLevel(tree, 'PROVINCE').find((p) => p.id === provincePick)?.children ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : tModal.mode === 'add' && tModal.parentOptions ? (
              <div className="mb-3">
                <label className="label">Parent {LEVEL_META[PARENT_LEVEL[tModal.level]!].label}</label>
                <select className="input" value={parentPick} onChange={(e) => setParentPick(e.target.value)}>
                  <option value="">Select…</option>
                  {tModal.parentOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            ) : null}
            <label className="label">{tModal.label} name</label>
            <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitTerritory()} />
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setTModal(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy || !name.trim()} onClick={submitTerritory}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {memberModal && (
        <AddMember
          modal={memberModal}
          onClose={() => setMemberModal(null)}
          onDone={() => {
            setMemberModal(null);
            refetch();
          }}
        />
      )}

      {detailsOrgId && <MemberDetails orgId={detailsOrgId} onClose={() => setDetailsOrgId(null)} />}
    </div>
  );
}

function AddMember({ modal, onClose, onDone }: { modal: MemberModal; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', contactName: '', contactPhone: '', contactEmail: '', adminName: '', adminEmail: '', adminPassword: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roleLabel = LEVEL_META[modal.node.level].role;

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await api.post('/orgs', {
        name: form.name,
        type: modal.type,
        parentId: modal.orgParentId,
        territoryId: modal.node.id,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        contactEmail: form.contactEmail || undefined,
        admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword },
      });
      onDone();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">Add member — {modal.node.name}</h2>
        <p className="mb-4 text-xs text-slate-500">New {roleLabel} for this {LEVEL_META[modal.node.level].label}. Starts as PENDING until approved.</p>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Business name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Contact name</label><input className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
          <div><label className="label">Phone</label><input className="input" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Contact email</label><input className="input" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
          <div className="col-span-2 mt-2 border-t border-slate-100 pt-3 text-xs font-semibold uppercase text-slate-400">Login for the member admin</div>
          <div><label className="label">Admin name</label><input className="input" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} /></div>
          <div><label className="label">Admin email</label><input className="input" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Temp password (min 6)</label><input className="input" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !form.name || !form.adminEmail || !form.adminPassword} onClick={submit}>{busy ? 'Creating…' : 'Add member'}</button>
        </div>
      </div>
    </div>
  );
}

interface OrgDetail {
  name: string;
  type: string;
  status: string;
  isActive: boolean;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  salesTarget: number;
  parent?: { name: string } | null;
}

function MemberDetails({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { data, loading, error } = useFetch<OrgDetail>(`/orgs/${orgId}`);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <Spinner />
        ) : error || !data ? (
          <Alert>{error || 'Not found'}</Alert>
        ) : (
          <>
            <h2 className="text-lg font-bold">{data.name}</h2>
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
              {data.type} · <Badge value={data.status} /> · {data.isActive ? 'Active' : 'Inactive'}
            </div>
            <dl className="space-y-1 text-sm">
              <Row k="Reports to" v={data.parent?.name ?? '—'} />
              <Row k="Contact" v={data.contactName ?? '—'} />
              <Row k="Email" v={data.contactEmail ?? '—'} />
              <Row k="Phone" v={data.contactPhone ?? '—'} />
              <Row k="Address" v={data.address ?? '—'} />
              <Row k="Sales target" v={`₱${(data.salesTarget ?? 0).toLocaleString()}`} />
            </dl>
            <button className="btn-ghost mt-4 w-full" onClick={onClose}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-right text-slate-700">{v}</dd>
    </div>
  );
}
