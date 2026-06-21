import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, Badge } from '../components/ui';
import { peso, dateTime } from '../lib/format';

interface Approval {
  id: string;
  type: 'ORG_ONBOARDING' | 'PO_APPROVAL';
  status: string;
  createdAt: string;
  org?: { id: string; name: string; type: string; contactName?: string };
  po?: { id: string; number: string; total: number; distributionType: string; buyerOrg: { name: string; type: string } };
}

export default function Approvals() {
  const { data, loading, error, refetch } = useFetch<{ approvals: Approval[] }>('/approvals?status=PENDING');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decideOrg(a: Approval, status: 'APPROVED' | 'REJECTED') {
    setBusyId(a.id);
    setActionErr(null);
    try {
      await api.post(`/approvals/${a.id}/decide`, { status });
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function decidePo(a: Approval, action: 'approve' | 'reject') {
    if (!a.po) return;
    setBusyId(a.id);
    setActionErr(null);
    try {
      await api.post(`/purchase-orders/${a.po.id}/${action}`);
      refetch();
    } catch (e) {
      setActionErr(apiError(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const list = data?.approvals ?? [];

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Onboarding requests and purchase orders awaiting your decision" />
      {actionErr && <div className="mb-4"><Alert>{actionErr}</Alert></div>}

      {list.length === 0 ? (
        <Alert kind="success">Nothing pending. You're all caught up. 🎉</Alert>
      ) : (
        <div className="space-y-3">
          {list.map((a) => (
            <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Badge value={a.type === 'ORG_ONBOARDING' ? 'ONBOARDING' : 'PO'} />
                  <span className="text-xs text-slate-400">{dateTime(a.createdAt)}</span>
                </div>
                {a.type === 'ORG_ONBOARDING' && a.org ? (
                  <div>
                    <div className="font-semibold">{a.org.name}</div>
                    <div className="text-sm text-slate-500">{a.org.type} · contact {a.org.contactName || '—'}</div>
                  </div>
                ) : a.po ? (
                  <div>
                    <div className="font-semibold">{a.po.number} · {peso(a.po.total)}</div>
                    <div className="text-sm text-slate-500">
                      From {a.po.buyerOrg.name} ({a.po.buyerOrg.type}) · {a.po.distributionType.replace('_', ' ')}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                {a.type === 'ORG_ONBOARDING' ? (
                  <>
                    <button className="btn-ghost text-red-600" disabled={busyId === a.id} onClick={() => decideOrg(a, 'REJECTED')}>Reject</button>
                    <button className="btn-primary" disabled={busyId === a.id} onClick={() => decideOrg(a, 'APPROVED')}>Approve</button>
                  </>
                ) : (
                  <>
                    <button className="btn-ghost text-red-600" disabled={busyId === a.id} onClick={() => decidePo(a, 'reject')}>Reject</button>
                    <button className="btn-primary" disabled={busyId === a.id} onClick={() => decidePo(a, 'approve')}>Approve</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
