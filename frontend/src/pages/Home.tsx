import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { canAccessFinance, hasDmsAccess, firstDmsPath } from '../lib/nav';

// A neutral launcher: pick a workspace. The "Distribution Management System"
// label and its sidebar only appear once you enter that workspace.
export default function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return <Navigate to="/login" replace />;

  const dms = hasDmsAccess(user);
  const finance = canAccessFinance(user);

  // Single workspace → skip the launcher and go straight in.
  if (dms && !finance) return <Navigate to={firstDmsPath(user)} replace />;
  if (finance && !dms) return <Navigate to="/finance" replace />;
  if (!dms && !finance) return <Navigate to="/account" replace />;

  const Tile = ({ onClick, icon, title, desc, accent }: { onClick: () => void; icon: string; title: string; desc: string; accent: string }) => (
    <button
      onClick={onClick}
      className={`group flex w-full max-w-sm flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      <div className={`flex h-14 w-14 items-center justify-center rounded-xl text-3xl ${accent}`}>{icon}</div>
      <div>
        <div className="text-lg font-bold text-slate-900">{title}</div>
        <div className="mt-1 text-sm text-slate-500">{desc}</div>
      </div>
      <span className="mt-2 text-sm font-semibold text-brand-600 group-hover:underline">Open →</span>
    </button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-9 w-auto object-contain" />
          <div className="text-sm font-bold text-slate-800">Tasty Food Manufacturing Inc.</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-800">{user.name}</div>
            <div className="text-xs text-slate-400">{user.email}</div>
          </div>
          <button onClick={logout} className="btn-ghost text-xs">Sign out</button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-6">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">Welcome, {user.name.split(' ')[0]}</h1>
        <p className="mb-8 text-sm text-slate-500">Choose a system to open.</p>
        <div className="flex flex-col items-stretch gap-5 sm:flex-row">
          {dms && (
            <Tile
              onClick={() => navigate(firstDmsPath(user))}
              icon="🚚"
              title="Distribution Management System"
              desc="Sales, inventory, purchase orders, distribution network, KPIs."
              accent="bg-brand-50 text-brand-600"
            />
          )}
          {finance && (
            <Tile
              onClick={() => navigate('/finance')}
              icon="📒"
              title="Finance & Accounting"
              desc="Double-entry books, journal entries, and financial reports."
              accent="bg-emerald-50 text-emerald-600"
            />
          )}
        </div>
      </main>
    </div>
  );
}
