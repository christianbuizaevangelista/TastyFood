import { useState } from 'react';
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

// Distinct icon, accent colour and role label per tier so they're easy to tell apart.
const LEVEL_META: Record<string, { icon: string; role: string; accent: string; label: string }> = {
  REGION: { icon: '🌏', role: 'Principal coverage', accent: 'border-slate-400 bg-slate-50', label: 'Region' },
  PROVINCE: { icon: '🏛️', role: 'Provincial Distributor', accent: 'border-brand-400 bg-brand-50', label: 'Province' },
  CITY: { icon: '🏙️', role: 'City Distributor', accent: 'border-sky-400 bg-sky-50', label: 'City / Municipality' },
  BARANGAY: { icon: '🏠', role: 'Reseller', accent: 'border-violet-400 bg-violet-50', label: 'Barangay' },
};

function Node({ node, depth }: { node: TNode; depth: number }) {
  // Top level starts expanded; deeper levels are collapsed until clicked.
  const [open, setOpen] = useState(depth === 0);
  const meta = LEVEL_META[node.level];
  const hasChildren = node.children.length > 0;
  const vacantCount = countVacant(node);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: `${depth * 1.5}rem` }}
        className="flex w-full items-center justify-between border-b border-slate-50 py-2 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <span className="w-4 text-xs text-slate-400">
            {hasChildren ? (open ? '▼' : '▶') : ''}
          </span>
          <span className={`flex h-7 w-7 items-center justify-center rounded-md border-l-4 ${meta.accent}`}>
            {meta.icon}
          </span>
          <span className={node.level === 'REGION' ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}>
            {node.name}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-right">
          {node.level === 'REGION' ? (
            <span className="text-xs text-slate-400">{vacantCount} vacant inside</span>
          ) : node.assignedOrg ? (
            <span className="text-xs text-slate-600">
              {node.assignedOrg.name}
              <span className="ml-2"><Badge value={node.assignedOrg.status} /></span>
            </span>
          ) : (
            <span className="badge bg-amber-100 text-amber-700">VACANT · {meta.role}</span>
          )}
        </div>
      </button>

      {open && (
        <>
          {/* Detail strip shown under the selected area */}
          <div
            style={{ marginLeft: `${depth * 1.5 + 1.75}rem` }}
            className="my-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500"
          >
            <span className="font-semibold text-slate-600">{meta.label}</span> ·{' '}
            {node.level === 'REGION'
              ? `${node.children.length} province(s), ${vacantCount} vacant slot(s) below`
              : node.assignedOrg
              ? `Assigned to ${node.assignedOrg.name} (${node.assignedOrg.type}) — ${node.assignedOrg.status}`
              : `Vacant — open for a ${meta.role}`}
          </div>
          {node.children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} />
          ))}
        </>
      )}
    </div>
  );
}

// Count vacant assignable territories within a node's subtree.
function countVacant(node: TNode): number {
  let n = node.level !== 'REGION' && node.vacant ? 1 : 0;
  for (const c of node.children) n += countVacant(c);
  return n;
}

export default function Structure() {
  const { user } = useAuth();
  const { data, loading, error } = useFetch<StructureData>('/territories');

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const scopeNote =
    user!.role === 'PRINCIPAL'
      ? 'All regions, provinces, cities/municipalities and barangays.'
      : 'Your territory and the locations beneath it. Areas outside your territory are hidden.';

  return (
    <div>
      <PageHeader title="Organization Structure" subtitle={scopeNote} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Vacant Provinces"
          value={`${data.summary.vacant.PROVINCE} / ${data.summary.total.PROVINCE}`}
          hint="Provincial Distributor"
          accent={data.summary.vacant.PROVINCE ? 'text-amber-600' : 'text-slate-900'}
        />
        <KpiCard
          label="Vacant Cities/Municipalities"
          value={`${data.summary.vacant.CITY} / ${data.summary.total.CITY}`}
          hint="City Distributor"
          accent={data.summary.vacant.CITY ? 'text-amber-600' : 'text-slate-900'}
        />
        <KpiCard
          label="Vacant Barangays"
          value={`${data.summary.vacant.BARANGAY} / ${data.summary.total.BARANGAY}`}
          hint="Reseller"
          accent={data.summary.vacant.BARANGAY ? 'text-amber-600' : 'text-slate-900'}
        />
      </div>

      <div className="card">
        {data.tree.length === 0 ? (
          <p className="text-sm text-slate-400">No territory assigned to your account yet.</p>
        ) : (
          data.tree.map((n) => <Node key={n.id} node={n} depth={0} />)
        )}
      </div>
    </div>
  );
}
