export type Role = 'PRINCIPAL' | 'PROVINCIAL' | 'CITY' | 'RESELLER';
export type OrgType = Role;
export type DistributionType = 'TRADE' | 'DROP_SHIP';
export type PoStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'FULFILLED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isOwner: boolean;
  permissions: string[];
  org: {
    id: string;
    name: string;
    type: OrgType;
    discountRate: number;
    parentId?: string | null;
    territory?: { name: string; level: string } | null;
  };
}

export interface Customer {
  id: string;
  name: string;
  type?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  owner?: { id: string; name: string; type: OrgType };
  salesCount?: number;
  totalAmount?: number;
  createdAt?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  category?: string | null;
  size?: string | null;
  srp: number;
  retailSrp?: number | null;
}

export interface InventoryItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  size?: string | null;
  category?: string;
  srp: number;
  cost?: number | null;
  quantity: number;
  reorderLevel: number | null;
  lowStock: boolean;
  stockValue: number;
  costValue?: number | null;
}

export interface Org {
  id: string;
  name: string;
  type: OrgType;
  segment?: 'RESELLER' | 'RETAIL';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  isActive: boolean;
  discountRate: number;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  notes?: string;
  salesTarget: number;
  parent?: { id: string; name: string; type: OrgType } | null;
  territory?: { id: string; name: string; level: string } | null;
  pendingInvite?: boolean;
  _count?: { children: number; users: number };
}
