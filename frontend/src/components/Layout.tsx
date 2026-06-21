import { NavLink, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { navForRole, ROLE_LABEL } from '../lib/nav';

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  if (!user) return null;
  const items = navForRole(user.role);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col bg-brand-700 text-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-500 text-xl font-black text-brand-900">
            JP
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold">Juan Palaman</div>
            <div className="text-[11px] text-brand-100">Tasty Food Mfg. Inc.</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map((item) => {
            const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-white/15 text-white' : 'text-brand-100 hover:bg-white/10'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-4 py-4 text-xs text-brand-100">
          <div className="font-semibold text-white">{user.org.name}</div>
          <div>{ROLE_LABEL[user.role]}</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm text-slate-500">
            Distribution Management System
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800">{user.name}</div>
              <div className="text-xs text-slate-400">{user.email}</div>
            </div>
            <button onClick={logout} className="btn-ghost text-xs">
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
