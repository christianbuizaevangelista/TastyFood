import { NavLink, useLocation } from 'react-router-dom';
import { ReactNode, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { navForUser, ROLE_LABEL } from '../lib/nav';

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  // Collapsible sidebar — remembered across sessions.
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('dms_sidebar') === '1'
  );
  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('dms_sidebar', next ? '1' : '0'); } catch {}
      return next;
    });
  }
  if (!user) return null;
  const items = navForUser(user);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      {!collapsed && (
      <aside className="flex w-64 flex-col bg-brand-700 text-white">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white p-1">
            <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-full w-full object-contain" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold">Tasty Food Manufacturing Inc.</div>
            <div className="text-[11px] text-brand-100">Distribution Management System (DMS)</div>
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
          {user.org.territory && (
            <div className="mt-0.5 text-brand-200">📍 {user.org.territory.name}</div>
          )}
        </div>
      </aside>
      )}

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              title={collapsed ? 'Show menu' : 'Hide menu'}
              aria-label={collapsed ? 'Show menu' : 'Hide menu'}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {collapsed && (
              <img src="/tasty-food-splash.png" alt="Tasty Food" className="h-7 w-auto object-contain" />
            )}
            <span className="text-sm text-slate-500">Distribution Management System</span>
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
