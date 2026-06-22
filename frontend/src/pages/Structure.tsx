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

const LEVEL_META: Record<string, { icon: string; pad: string; role: string }> = {
  REGION: { icon: '🗺️', pad: 'pl-0', role: '' },
  PROVINCE: { icon: '🏞️', pad: 'pl-6', role: 'Provincial Distributor' },
  CITY: { icon: '🏙️', pad: 'pl-12', role: 'City Distributor' },
  BARANGAY: { icon: '🏘️', pad: 'pl-[4.5rem]', role: 'Reseller' },
};

function Node({ node }: { node: TNode }) {
  const meta = LEVEL_META[node.level];
  return (
    <div>
      <div className={`flex items-center justify-between border-b border-slate-50 py-2 ${meta.pad}`}>
        <div className="flex items-center gap-2">
          <span>{meta.icon}</span>
          <span className={node.level === 'REGION' ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}>
            {node.name}
          </span>
          <span className="text-xs text-slate-400">{node.level}</span>
        </div>
        <div className="text-right">
          {node.level === 'REGION' ? null : node.assignedOrg ? (
            <span className="text-xs text-slate-600">
              {node.assignedOrg.name}
              <span className="ml-2"><Badge value={node.assignedOrg.status} /></span>
            </span>
          ) : (
            <span className="badge bg-amber-100 text-amber-700">
              VACANT · {meta.role}
            </span>
          )}
        </div>
      </div>
      {node.children.map((c) => (
        <Node key={c.id} node={c} />
      ))}
    </div>
  );
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
          data.tree.map((n) => <Node key={n.id} node={n} />)
        )}
      </div>
    </div>
  );
}
