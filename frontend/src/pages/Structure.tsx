import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, KpiCard, Badge } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

interface TNode {
  id: string;
  name: string;
  level: 'REGION' | 'PROVINCE' | 'CITY' | 'BARANGAY';
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

// What child level (if any) each level can contain.
const CHILD: Record<string, { level: TNode['level']; label: string } | null> = {
  REGION: { level: 'PROVINCE', label: 'Province' },
  PROVINCE: { level: 'CITY', label: 'City / Municipality' },
  CITY: { level: 'BARANGAY', label: 'Barangay' },
  BARANGAY: null,
};

function countVacant(node: TNode): number {
  let n = node.level !== 'REGION' && node.vacant ? 1 : 0;
  for (const c of node.children) n += countVacant(c);
  return n;
}

interface Actions {
  canManage: boolean;
  onAddChild: (parent: TNode) => void;
  onRename: (node: TNode) => void;
  onDelete: (node: TNode) => void;
}

function Node({ node, depth, actions }: { node: TNode; depth: number; actions: Actions }) {
  const [open, setOpen] = useState(depth === 0);
  const meta = LEVEL_META[node.level];
  const hasChildren = node.children.length > 0;
  const child = CHILD[node.level];

  return (
    <div>
      <div
        className="flex items-center justify-between border-b border-slate-50 py-2 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 1.5}rem` }}
      >
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-2 text-left">
          <span className="w-4 text-xs text-slate-400">{hasChildren ? (open ? '▼' : '▶') : ''}</span>
          <span className={`flex h-7 w-7 items-center justify-center rounded-md border-l-4 ${meta.accent}`}>
            {meta.icon}
          </span>
          <span className={node.level === 'REGION' ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}>
            {node.name}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
            {meta.label}
          </span>
        </button>

        <div className="flex items-center gap-2">
          {node.level === 'REGION' ? (
            <span className="text-xs text-slate-400">{countVacant(node)} vacant inside</span>
          ) : node.assignedOrg ? (
            <span className="text-xs text-slate-600">
              {node.assignedOrg.name} <Badge value={node.assignedOrg.status} />
            </span>
          ) : (
            <span className="badge bg-amber-100 text-amber-700">VACANT · {meta.role}</span>
          )}

          {actions.canManage && (
            <span className="flex items-center gap-1">
              {child && (
                <button
                  onClick={() => actions.onAddChild(node)}
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-brand-600 hover:bg-brand-50"
                  title={`Add ${child.label}`}
                >
                  + {child.label}
                </button>
              )}
              <button onClick={() => actions.onRename(node)} className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100" title="Rename">
                ✎
              </button>
              <button onClick={() => actions.onDelete(node)} className="rounded px-1 text-xs text-red-500 hover:bg-red-50" title="Delete">
                🗑
              </button>
            </span>
          )}
        </div>
      </div>

      {open && (
        <>
          <div
            style={{ marginLeft: `${depth * 1.5 + 1.75}rem` }}
            className="my-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500"
          >
            <span className="font-semibold text-slate-600">{meta.label}</span> ·{' '}
            {node.level === 'REGION'
              ? `${node.children.length} province(s), ${countVacant(node)} vacant slot(s) below`
              : node.assignedOrg
              ? `Assigned to ${node.assignedOrg.name} (${node.assignedOrg.type}) — ${node.assignedOrg.status}`
              : `Vacant — open for a ${meta.role}`}
          </div>
          {node.children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} actions={actions} />
          ))}
        </>
      )}
    </div>
  );
}

interface ModalState {
  mode: 'add' | 'rename';
  level: TNode['level'];
  label: string;
  parentId?: string;
  parentName?: string;
  target?: TNode;
}

export default function Structure() {
  const { user } = useAuth();
  const canManage = user!.role === 'PRINCIPAL';
  const { data, loading, error, refetch } = useFetch<StructureData>('/territories');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  function openAddChild(parent: TNode) {
    const child = CHILD[parent.level];
    if (!child) return;
    setName('');
    setActionErr(null);
    setModal({ mode: 'add', level: child.level, label: child.label, parentId: parent.id, parentName: parent.name });
  }
  function openAddRegion() {
    setName('');
    setActionErr(null);
    setModal({ mode: 'add', level: 'REGION', label: 'Region' });
  }
  function openRename(node: TNode) {
    setName(node.name);
    setActionErr(null);
    setModal({ mode: 'rename', level: node.level, label: LEVEL_META[node.level].label, target: node });
  }
  async function onDelete(node: TNode) {
    if (!window.confirm(`Delete "${node.name}"? This cannot be undone.`)) return;
    setActionErr(null);
    try {
      await api.delete(`/territories/${node.id}`);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    }
  }
  async function submitModal() {
    if (!modal || !name.trim()) return;
    setBusy(true);
    setActionErr(null);
    try {
      if (modal.mode === 'add') {
        await api.post('/territories', { name: name.trim(), level: modal.level, parentId: modal.parentId });
      } else if (modal.target) {
        await api.patch(`/territories/${modal.target.id}`, { name: name.trim() });
      }
      setModal(null);
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

  const actions: Actions = { canManage, onAddChild: openAddChild, onRename: openRename, onDelete };
  const scopeNote = canManage
    ? 'All regions, provinces, cities/municipalities and barangays. Encode and manage areas here.'
    : 'Your territory and the locations beneath it. Areas outside your territory are hidden.';

  return (
    <div>
      <PageHeader
        title="Organization Structure"
        subtitle={scopeNote}
        action={canManage ? <button className="btn-primary" onClick={openAddRegion}>+ Add Region</button> : undefined}
      />

      {actionErr && <div className="mb-4"><Alert>{actionErr}</Alert></div>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Vacant Provinces" value={`${data.summary.vacant.PROVINCE} / ${data.summary.total.PROVINCE}`} hint="Provincial Distributor" accent={data.summary.vacant.PROVINCE ? 'text-amber-600' : 'text-slate-900'} />
        <KpiCard label="Vacant Cities/Municipalities" value={`${data.summary.vacant.CITY} / ${data.summary.total.CITY}`} hint="City Distributor" accent={data.summary.vacant.CITY ? 'text-amber-600' : 'text-slate-900'} />
        <KpiCard label="Vacant Barangays" value={`${data.summary.vacant.BARANGAY} / ${data.summary.total.BARANGAY}`} hint="Reseller" accent={data.summary.vacant.BARANGAY ? 'text-amber-600' : 'text-slate-900'} />
      </div>

      <div className="card">
        {data.tree.length === 0 ? (
          <p className="text-sm text-slate-400">
            {canManage ? 'No areas yet. Click “+ Add Region” to start encoding.' : 'No territory assigned to your account yet.'}
          </p>
        ) : (
          data.tree.map((n) => <Node key={n.id} node={n} depth={0} actions={actions} />)
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">
              {modal.mode === 'add' ? `Add ${modal.label}` : `Rename ${modal.label}`}
            </h2>
            {modal.mode === 'add' && modal.parentName && (
              <p className="mb-3 text-xs text-slate-500">Under: {modal.parentName}</p>
            )}
            {actionErr && <div className="mb-3"><Alert>{actionErr}</Alert></div>}
            <label className="label">{modal.label} name</label>
            <input
              className="input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitModal()}
              placeholder={`e.g. ${modal.level === 'BARANGAY' ? 'Barangay San Jose' : modal.level === 'REGION' ? 'Mindanao' : modal.label}`}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy || !name.trim()} onClick={submitModal}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
