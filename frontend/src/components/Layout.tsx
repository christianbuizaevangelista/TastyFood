import { NavLink, useLocation } from 'react-router-dom';
import { ReactNode, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { dmsNavForUser, canAccessFinance, ROLE_LABEL } from '../lib/nav';

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  // Collapsible sidebar — remembered across sessions.
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('dms_sidebar') === '1'
  );
  // The DMS modules live inside a collapsible "folder" in the sidebar.
  const [dmsOpen, setDmsOpen] = useState(true);
  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('dms_sidebar', next ? '1' : '0'); } catch {}
      return next;
    });
  }
  if (!user) return null;
  const items = dmsNavForUser(user);
  // Users & Roles and Account Settings sit at the bottom, outside the modules folder.
  const BOTTOM_PATHS = ['/users', '/account'];
  const folderItems = items.filter((i) => !BOTTOM_PATHS.includes(i.to));
  const bottomItems = items.filter((i) => BOTTOM_PATHS.includes(i.to));

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
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          <button
            onClick={() => setDmsOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            <span>{dmsOpen ? '📂' : '📁'}</span>
            <span className="flex-1 text-left">Distribution Management System</span>
            <span className="text-xs text-brand-200">{dmsOpen ? '▾' : '▸'}</span>
          </button>
          {dmsOpen && (
            <div className="ml-3 space-y-1 border-l border-white/10 pl-2">
              {folderItems.map((item) => {
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
            </div>
          )}
        </nav>

        {bottomItems.length > 0 && (
          <div className="space-y-1 border-t border-white/10 px-3 py-2">
            {bottomItems.map((item) => {
              const active = location.pathname.startsWith(item.to);
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
          </div>
        )}

        {canAccessFinance(user) && (
          <div className="px-3 pb-2">
            <NavLink
              to="/home"
              className="flex items-center gap-3 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white hover:bg-white/15"
            >
              <span>⊞</span>
              <span className="flex-1">Switch app</span>
              <span className="text-brand-200">↗</span>
            </NavLink>
          </div>
        )}

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
