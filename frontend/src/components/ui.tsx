import { ReactNode } from 'react';

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-8 text-slate-400">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent ?? 'text-slate-900'}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  RECEIVED: 'bg-green-100 text-green-700',
  FULFILLED: 'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-amber-100 text-amber-700',
  SUBMITTED: 'bg-amber-100 text-amber-700',
  DRAFT: 'bg-slate-100 text-slate-600',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-red-100 text-red-700',
  TRADE: 'bg-sky-100 text-sky-700',
  DROP_SHIP: 'bg-violet-100 text-violet-700',
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${STATUS_STYLES[value] ?? 'bg-slate-100 text-slate-600'}`}>{value.replace('_', ' ')}</span>;
}

export function Alert({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'info' | 'success' }) {
  const styles = {
    error: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    success: 'bg-green-50 text-green-700 border-green-200',
  }[kind];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card text-center text-sm text-slate-400">{children}</div>;
}
