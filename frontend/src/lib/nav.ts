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

// Sidebar modules, filtered by role + permission. Order reflects UX priority.
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: ALL },
  { to: '/structure', label: 'Org Structure', icon: '🗺️', roles: ALL, perm: 'structure' },
  { to: '/inventory', label: 'Inventory', icon: '📦', roles: ALL, perm: 'inventory' },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: '🧾', roles: ALL, perm: 'purchase-orders' },
  { to: '/pos', label: 'Point of Sale', icon: '🛒', roles: ALL, perm: 'pos' },
  { to: '/mana', label: 'Mana Wallet', icon: '✨', roles: ALL, perm: 'mana' },
  { to: '/sales', label: 'Sales Report', icon: '📈', roles: ALL, perm: 'sales' },
  { to: '/kpi', label: 'KPI & Leaderboards', icon: '🏆', roles: ['PRINCIPAL', 'PROVINCIAL', 'CITY'], perm: 'kpi' },
  { to: '/crm', label: 'CRM / Accounts', icon: '🤝', roles: ['PRINCIPAL', 'PROVINCIAL', 'CITY'], perm: 'crm' },
  { to: '/approvals', label: 'Approvals', icon: '✅', roles: ['PRINCIPAL', 'PROVINCIAL'], perm: 'approvals' },
  { to: '/products', label: 'Products', icon: '🏷️', roles: ['PRINCIPAL'], perm: 'products' },
  { to: '/users', label: 'Users & Roles', icon: '🔑', roles: ALL, ownerOnly: true },
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

export const ROLE_LABEL: Record<Role, string> = {
  PRINCIPAL: 'Principal',
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
};
