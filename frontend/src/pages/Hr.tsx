import { ReactNode, useState } from 'react';
import { api, apiError } from '../api/client';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState, KpiCard } from '../components/ui';
import { peso, num, date } from '../lib/format';

const EMP_TYPES = ['REGULAR', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME'] as const;
const EMP_STATUS = ['ACTIVE', 'INACTIVE', 'RESIGNED'] as const;
const ATT_STATUS = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY'] as const;
const LEAVE_TYPES = ['VACATION', 'SICK', 'EMERGENCY', 'UNPAID'] as const;
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
const badge = (s: string) => {
  const m: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700', INACTIVE: 'bg-slate-100 text-slate-500', RESIGNED: 'bg-red-100 text-red-700',
    APPROVED: 'bg-green-100 text-green-700', PENDING: 'bg-amber-100 text-amber-700', REJECTED: 'bg-red-100 text-red-700',
    PRESENT: 'bg-green-100 text-green-700', ABSENT: 'bg-red-100 text-red-700', LATE: 'bg-amber-100 text-amber-700',
  };
  return m[s] ?? 'bg-slate-100 text-slate-600';
};

// ============================ HR Dashboard ==================================
export function HrDashboard() {
  const { data, loading, error } = useFetch<any>('/hr/summary');
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const d = data!;
  return (
    <div>
      <PageHeader title="HR Dashboard" subtitle="People overview at a glance" />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard label="Headcount" value={num(d.headcount)} hint={`${d.active} active`} accent="text-teal-600" />
        <KpiCard label="Present Today" value={num(d.presentToday)} />
        <KpiCard label="On Leave Today" value={num(d.onLeaveToday)} />
        <KpiCard label="Pending Leave Requests" value={num(d.pendingLeaves)} accent={d.pendingLeaves ? 'text-amber-600' : 'text-slate-900'} />
        <KpiCard label="Inactive / Resigned" value={num(d.inactive)} />
      </div>
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Headcount by Department</h3>
        {d.byDepartment.length === 0 ? (
          <EmptyState>No employees yet.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {d.byDepartment.map((r: any) => (
                <tr key={r.department} className="border-b border-slate-50">
                  <td className="td">{r.department}</td>
                  <td className="td text-right font-semibold">{num(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============================ Employees =====================================
export function Employees() {
  const { data, loading, error, refetch } = useFetch<{ employees: any[] }>('/hr/employees');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del(e: any) {
    if (!confirm(`Delete ${e.firstName} ${e.lastName}? Their attendance & leave records will also be removed.`)) return;
    setErr(null);
    try { await api.delete(`/hr/employees/${e.id}`); refetch(); } catch (x) { setErr(apiError(x)); }
  }
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader title="Employees" subtitle="201 files — employee records" action={<button className="btn-primary" onClick={() => setCreating(true)}>+ New Employee</button>} />
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {data!.employees.length === 0 ? (
        <EmptyState>No employees yet. Click “New Employee”.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="th">Emp No</th><th className="th">Name</th><th className="th">Position</th><th className="th">Department</th>
              <th className="th">Type</th><th className="th">Status</th><th className="th text-right">Base Salary</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {data!.employees.map((e) => (
                <tr key={e.id} className="border-b border-slate-50">
                  <td className="td font-mono text-xs">{e.employeeNo}</td>
                  <td className="td font-medium">{e.firstName} {e.lastName}</td>
                  <td className="td">{e.position || '—'}</td>
                  <td className="td">{e.department || '—'}</td>
                  <td className="td text-xs">{e.employmentType}</td>
                  <td className="td"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge(e.status)}`}>{e.status}</span></td>
                  <td className="td text-right">{peso(e.baseSalary)}</td>
                  <td className="td whitespace-nowrap text-right text-xs">
                    <button className="text-brand-600 hover:underline" onClick={() => setEditing(e)}>Edit</button>
                    <button className="ml-3 text-red-600 hover:underline" onClick={() => del(e)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(creating || editing) && (
        <EmployeeForm employee={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); refetch(); }} />
      )}
    </div>
  );
}

function EmployeeForm({ employee, onClose, onSaved }: { employee: any | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!employee;
  const [f, setF] = useState({
    employeeNo: employee?.employeeNo ?? '', firstName: employee?.firstName ?? '', lastName: employee?.lastName ?? '',
    position: employee?.position ?? '', department: employee?.department ?? '',
    employmentType: employee?.employmentType ?? 'REGULAR', status: employee?.status ?? 'ACTIVE',
    dateHired: employee?.dateHired ? String(employee.dateHired).slice(0, 10) : '',
    email: employee?.email ?? '', phone: employee?.phone ?? '', address: employee?.address ?? '',
    baseSalary: String(employee?.baseSalary ?? ''), notes: employee?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  async function save() {
    setErr(null);
    if (!f.employeeNo.trim() || !f.firstName.trim() || !f.lastName.trim()) return setErr('Employee No, first and last name are required.');
    setBusy(true);
    try {
      const payload = {
        employeeNo: f.employeeNo.trim(), firstName: f.firstName.trim(), lastName: f.lastName.trim(),
        position: f.position.trim() || null, department: f.department.trim() || null,
        employmentType: f.employmentType, status: f.status,
        dateHired: f.dateHired || null, email: f.email.trim() || null, phone: f.phone.trim() || null,
        address: f.address.trim() || null, baseSalary: Number(f.baseSalary) || 0, notes: f.notes.trim() || null,
      };
      if (isEdit) await api.put(`/hr/employees/${employee.id}`, payload);
      else await api.post('/hr/employees', payload);
      onSaved();
    } catch (e) { setErr(apiError(e)); setBusy(false); }
  }
  const T = ({ k, label }: { k: keyof typeof f; label: string }) => (
    <div><label className="label">{label}</label><input className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} /></div>
  );

  return (
    <Modal title={isEdit ? 'Edit Employee' : 'New Employee'} onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="grid grid-cols-2 gap-3">
        <T k="employeeNo" label="Employee No" />
        <div><label className="label">Base Salary (₱/mo)</label><input type="number" min={0} step="0.01" className="input" value={f.baseSalary} onChange={(e) => set('baseSalary', e.target.value)} /></div>
        <T k="firstName" label="First name" />
        <T k="lastName" label="Last name" />
        <T k="position" label="Position" />
        <T k="department" label="Department" />
        <div><label className="label">Employment type</label><select className="input" value={f.employmentType} onChange={(e) => set('employmentType', e.target.value)}>{EMP_TYPES.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><label className="label">Status</label><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>{EMP_STATUS.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><label className="label">Date hired</label><input type="date" className="input" value={f.dateHired} onChange={(e) => set('dateHired', e.target.value)} /></div>
        <T k="phone" label="Phone" />
        <T k="email" label="Email" />
        <T k="address" label="Address" />
      </div>
      <div className="mt-3"><label className="label">Notes</label><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add employee'}</button>
      </div>
    </Modal>
  );
}

// ============================ Attendance ====================================
export function Attendance() {
  const [day, setDay] = useState(today());
  const url = `/hr/attendance?date=${day}`;
  const { data, loading, error, refetch } = useFetch<any>(url, [url]);
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = rows ?? data?.rows ?? [];
  const setRow = (i: number, patch: any) => setRows(list.map((r: any, j: number) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setErr(null); setNote(null); setBusy(true);
    try {
      const records = list.map((r: any) => ({ employeeId: r.employeeId, status: r.status, timeIn: r.timeIn || null, timeOut: r.timeOut || null }));
      const { data: res } = await api.post('/hr/attendance', { date: day, records });
      setNote(`Saved attendance for ${res.saved} employees.`); setRows(null); refetch();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Daily time records" action={
        <div className="flex items-center gap-2">
          <input type="date" className="input" value={day} onChange={(e) => { setDay(e.target.value); setRows(null); setNote(null); }} />
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</button>
        </div>
      } />
      {note && <div className="mb-3"><Alert kind="success">{note}</Alert></div>}
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {list.length === 0 ? (
        <EmptyState>No active employees. Add employees first.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="th">Employee</th><th className="th">Department</th><th className="th">Status</th><th className="th">Time In</th><th className="th">Time Out</th>
            </tr></thead>
            <tbody>
              {list.map((r: any, i: number) => (
                <tr key={r.employeeId} className="border-b border-slate-50">
                  <td className="td font-medium">{r.name}</td>
                  <td className="td">{r.department || '—'}</td>
                  <td className="td"><select className="input" value={r.status} onChange={(e) => setRow(i, { status: e.target.value })}>{ATT_STATUS.map((o) => <option key={o}>{o}</option>)}</select></td>
                  <td className="td"><input type="time" className="input" value={r.timeIn || ''} onChange={(e) => setRow(i, { timeIn: e.target.value })} /></td>
                  <td className="td"><input type="time" className="input" value={r.timeOut || ''} onChange={(e) => setRow(i, { timeOut: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================ Leave =========================================
export function Leave() {
  const { data, loading, error, refetch } = useFetch<{ leaves: any[] }>('/hr/leaves');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setErr(null);
    try { await api.post(`/hr/leaves/${id}/decision`, { decision }); refetch(); } catch (e) { setErr(apiError(e)); }
  }
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div>
      <PageHeader title="Leave Requests" subtitle="File and approve employee leaves" action={<button className="btn-primary" onClick={() => setCreating(true)}>+ File Leave</button>} />
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {data!.leaves.length === 0 ? (
        <EmptyState>No leave requests yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="th">Employee</th><th className="th">Type</th><th className="th">Dates</th><th className="th text-right">Days</th><th className="th">Reason</th><th className="th">Status</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {data!.leaves.map((l) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="td font-medium">{l.employee.firstName} {l.employee.lastName}</td>
                  <td className="td text-xs">{l.type}</td>
                  <td className="td text-xs">{date(l.startDate)} → {date(l.endDate)}</td>
                  <td className="td text-right">{l.days}</td>
                  <td className="td text-xs text-slate-500">{l.reason || '—'}</td>
                  <td className="td"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge(l.status)}`}>{l.status}</span></td>
                  <td className="td whitespace-nowrap text-right text-xs">
                    {l.status === 'PENDING' && (
                      <>
                        <button className="text-green-600 hover:underline" onClick={() => decide(l.id, 'APPROVED')}>Approve</button>
                        <button className="ml-3 text-red-600 hover:underline" onClick={() => decide(l.id, 'REJECTED')}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <LeaveForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch(); }} />}
    </div>
  );
}

function LeaveForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const emps = useFetch<{ employees: any[] }>('/hr/employees');
  const [f, setF] = useState({ employeeId: '', type: 'VACATION', startDate: today(), endDate: today(), days: '1', reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  async function save() {
    setErr(null);
    if (!f.employeeId) return setErr('Select an employee.');
    setBusy(true);
    try {
      await api.post('/hr/leaves', {
        employeeId: f.employeeId, type: f.type, startDate: f.startDate, endDate: f.endDate,
        days: Number(f.days) || 1, reason: f.reason.trim() || null,
      });
      onSaved();
    } catch (e) { setErr(apiError(e)); setBusy(false); }
  }
  return (
    <Modal title="File Leave" onClose={onClose}>
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="space-y-3">
        <div><label className="label">Employee</label>
          <select className="input" value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
            <option value="">Select employee…</option>
            {(emps.data?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Type</label><select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>{LEAVE_TYPES.map((o) => <option key={o}>{o}</option>)}</select></div>
          <div><label className="label">Days</label><input type="number" min={0.5} step="0.5" className="input" value={f.days} onChange={(e) => set('days', e.target.value)} /></div>
          <div><label className="label">Start</label><input type="date" className="input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
          <div><label className="label">End</label><input type="date" className="input" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></div>
        </div>
        <div><label className="label">Reason</label><textarea className="input" rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'File leave'}</button>
      </div>
    </Modal>
  );
}

// ============================ Payroll =======================================
export function Payroll() {
  const [month, setMonth] = useState(thisMonth());
  const url = `/hr/payroll?month=${month}`;
  const { data, loading, error } = useFetch<any>(url, [url]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const d = data!;
  return (
    <div>
      <PageHeader title="Payroll" subtitle="Monthly payslips — statutory deductions are estimates" action={
        <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
      } />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Employees" value={num(d.totals.headcount)} />
        <KpiCard label="Total Basic" value={peso(d.totals.basic)} />
        <KpiCard label="Total Deductions" value={peso(d.totals.deductions)} accent="text-red-600" />
        <KpiCard label="Total Net Pay" value={peso(d.totals.net)} accent="text-green-600" />
      </div>
      {d.rows.length === 0 ? (
        <EmptyState>No active employees to run payroll for.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="th">Employee</th><th className="th text-right">Basic</th><th className="th text-right">Absences</th>
              <th className="th text-right">SSS</th><th className="th text-right">PhilHealth</th><th className="th text-right">Pag-IBIG</th>
              <th className="th text-right">Deductions</th><th className="th text-right">Net Pay</th>
            </tr></thead>
            <tbody>
              {d.rows.map((r: any) => (
                <tr key={r.employeeId} className="border-b border-slate-50">
                  <td className="td font-medium">{r.name}<div className="text-xs text-slate-400">{r.employeeNo}{r.department ? ` · ${r.department}` : ''}</div></td>
                  <td className="td text-right">{peso(r.basic)}</td>
                  <td className="td text-right">{r.absentDays ? `${r.absentDays}d · ${peso(r.absenceDeduction)}` : '—'}</td>
                  <td className="td text-right">{peso(r.sss)}</td>
                  <td className="td text-right">{peso(r.philhealth)}</td>
                  <td className="td text-right">{peso(r.pagibig)}</td>
                  <td className="td text-right text-red-600">{peso(r.totalDeductions)}</td>
                  <td className="td text-right font-semibold text-green-600">{peso(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
