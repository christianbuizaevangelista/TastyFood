import { Role } from '../types';

export interface NavItem {
  to: string;
  label: string;
  icon: string; // emoji for a dependency-free icon set
  roles: Role[];
}

const ALL: Role[] = ['PRINCIPAL', 'PROVINCIAL', 'CITY', 'RESELLER'];

// Sidebar modules, filtered by role. Order reflects the build/UX priority.
export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: ALL },
  { to: '/inventory', label: 'Inventory', icon: '📦', roles: ALL },
  { to: '/purchase-orders', label: 'Purchase Orders', icon: '🧾', roles: ALL },
  { to: '/pos', label: 'Point of Sale', icon: '🛒', roles: ['PROVINCIAL', 'CITY', 'RESELLER'] },
  { to: '/sales', label: 'Sales Report', icon: '📈', roles: ALL },
  { to: '/kpi', label: 'KPI & Leaderboards', icon: '🏆', roles: ['PRINCIPAL', 'PROVINCIAL', 'CITY'] },
  { to: '/crm', label: 'CRM / Accounts', icon: '🤝', roles: ['PRINCIPAL', 'PROVINCIAL', 'CITY'] },
  { to: '/approvals', label: 'Approvals', icon: '✅', roles: ['PRINCIPAL', 'PROVINCIAL'] },
  { to: '/products', label: 'Products', icon: '🏷️', roles: ['PRINCIPAL'] },
  { to: '/account', label: 'Account Settings', icon: '👤', roles: ALL },
];

export function navForRole(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}

export const ROLE_LABEL: Record<Role, string> = {
  PRINCIPAL: 'Principal',
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
};
