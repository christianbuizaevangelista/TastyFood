import { NavLink, useLocation } from 'react-router-dom';
import { ReactNode, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { hasDmsAccess } from '../lib/nav';

const FINANCE_NAV = [
  { to: '/finance', label: 'Reports', icon: '📊', exact: true },
  { to: '/finance/journal', label: 'Journal Entries', icon: '🧾', exact: false },
  { to: '/finance/retail', label: 'Retail Distributors', icon: '🏪', exact: false },
  { to: '/finance/accounts', label: 'Chart of Accounts', icon: '📚', exact: false },
];

export default function FinanceLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  if (!user) return null;
  const showBackToDms = hasDmsAccess(user);

  return (
    <div className="flex min-h-screen">
      {/* Finance sidebar — deliberately dark to feel like a separate system. */}
      <aside className="flex w-64 flex-col bg-slate-900 text-white">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white p-1">
            <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-full w-full object-contain" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold">Tasty Food Manufacturing Inc.</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            <span>{open ? '📂' : '📁'}</span>
            <span className="flex-1 text-left">Finance &amp; Accounting</span>
            <span className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
          </button>
          {open && (
            <div className="ml-3 space-y-1 border-l border-white/10 pl-2">
              {FINANCE_NAV.map((item) => {
                const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          )}
        </nav>

        {showBackToDms && (
          <div className="px-3 pb-2">
            <NavLink
              to="/home"
              className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
            >
              <span>⊞</span>
              <span className="flex-1">Switch app</span>
              <span className="text-slate-400">↗</span>
            </NavLink>
          </div>
        )}

        <div className="border-t border-white/10 px-4 py-4 text-xs text-slate-400">
          <div className="font-semibold text-white">{user.name}</div>
          <div>Finance Department</div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <span className="text-sm font-medium text-slate-500">Finance &amp; Accounting</span>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800">{user.name}</div>
              <div className="text-xs text-slate-400">{user.email}</div>
            </div>
            <button onClick={logout} className="btn-ghost text-xs">Sign out</button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
