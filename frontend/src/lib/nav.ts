import { AuthUser, Role } from '../types';

export interface NavItem {
  to: string;
  label: string;
  icon: string; // emoji for a dependency-free icon set
  roles: Role[];
  perm?: string; // permission key a staff user needs (owner always passes)
  ownerOnly?: boolean; // only the org owner sees this
}

const ALL: Role[] = ['PRINCIPAL', 'PROVINCIAL', 'CITY', 'RESELLER'];
// Resellers get a deliberately tiny, no-training experience (Record Sale +
// Customers only); the heavier modules are hidden from them.
const UP: Role[] = ['PRINCIPAL', 'PROVINCIAL', 'CITY'];

// Sidebar modules, filtered by role + permission. Order reflects UX priority.
// Ordered by how often each is used / how important it is: daily transactional
// tools first, then monitoring, then management, then setup/admin, account last.
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: UP, perm: 'dashboard' },
  { to: '/sell', label: 'Record Sale', icon: '🧾', roles: ['RESELLER'], perm: 'pos' },
  { to: '/pos', label: 'Point of Sale', icon: '🛒', roles: UP, perm: 'pos' },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: '🧾', roles: ALL, perm: 'purchase-orders' },
  { to: '/inventory', label: 'Inventory', icon: '📦', roles: UP, perm: 'inventory' },
  { to: '/sales', label: 'Sales Report', icon: '📈', roles: UP, perm: 'sales' },
  { to: '/mana', label: 'Mana Wallet', icon: '✨', roles: ALL, perm: 'mana' },
  { to: '/crm', label: 'Distribution Network', icon: '🤝', roles: UP, perm: 'crm' },
  { to: '/kpi', label: 'KPI & Leaderboards', icon: '🏆', roles: UP, perm: 'kpi' },
  { to: '/structure', label: 'Org Structure', icon: '🗺️', roles: UP, perm: 'structure' },
  { to: '/customers', label: 'Customers', icon: '👥', roles: ALL, perm: 'customers' },
  { to: '/referrals', label: 'Referrals', icon: '📨', roles: ALL, perm: 'referrals' },
  { to: '/products', label: 'Products', icon: '🏷️', roles: ['PRINCIPAL'], perm: 'products' },
  { to: '/materials', label: 'Downloadables', icon: '📥', roles: UP, perm: 'materials' },
  { to: '/users', label: 'Users & Roles', icon: '🔑', roles: ['PRINCIPAL'], ownerOnly: true },
  { to: '/account', label: 'Account Settings', icon: '👤', roles: ALL },
];

// True if the user may access an item (role + permission/owner gates).
export function canAccess(user: Pick<AuthUser, 'role' | 'isOwner' | 'permissions'>, item: NavItem): boolean {
  if (!item.roles.includes(user.role)) return false;
  if (item.ownerOnly) return user.isOwner;
  if (!item.perm) return true; // open module (dashboard, account)
  return user.isOwner || (user.permissions ?? []).includes(item.perm);
}

export function navForUser(user: Pick<AuthUser, 'role' | 'isOwner' | 'permissions'>): NavItem[] {
  return NAV.filter((n) => canAccess(user, n));
}

// Can the user reach a given route path? (used to guard routes)
export function canAccessPath(user: Pick<AuthUser, 'role' | 'isOwner' | 'permissions'>, path: string): boolean {
  const item = NAV.find((n) => n.to === path);
  if (!item) return true; // unknown/utility route
  return canAccess(user, item);
}

// The first sidebar destination the user can open — used as their landing page
// (staff who lack Dashboard access are sent to their first assigned module).
export function firstAccessiblePath(user: Pick<AuthUser, 'role' | 'isOwner' | 'permissions'>): string {
  return navForUser(user)[0]?.to ?? '/account';
}

export const ROLE_LABEL: Record<Role, string> = {
  PRINCIPAL: 'Principal',
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
};
