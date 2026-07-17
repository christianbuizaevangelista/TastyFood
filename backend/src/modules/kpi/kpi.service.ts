import { PoStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// A purchase is "committed" once the supplier approves it (through received);
// DRAFT/SUBMITTED (not yet approved) and CANCELLED don't count.
const COMMITTED_PO: PoStatus[] = ['APPROVED', 'FULFILLED', 'PARTIALLY_RECEIVED', 'RECEIVED'];

export interface OrgKpi {
  orgId: string;
  orgName: string;
  orgType: string;
  segment: string;
  revenue: number;
  prevRevenue: number;
  growthPct: number;
  salesVolume: number; // units
  target: number;
  targetAttainmentPct: number;
  activeMembers: number;
  poFulfillmentRate: number; // 0..1
  inventoryTurnover: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Computes KPIs for a set of orgs over [from, to], comparing against the
// equally-sized immediately-preceding window for growth. A distributor's
// "revenue" here is its SELL-IN: the value of goods it purchased from its
// supplier (i.e. sales where it is the buyer), which is what the Principal
// tracks per account.
export async function computeOrgKpis(
  orgIds: string[],
  from: Date,
  to: Date
): Promise<OrgKpi[]> {
  if (orgIds.length === 0) return [];

  const windowMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - windowMs);

  const [orgs, allOrgs, currentSales, prevSales, children, pos, inventory] = await Promise.all([
    prisma.organization.findMany({ where: { id: { in: orgIds } } }),
    // The whole tree (id → parent) so we can resolve each buyer's full upline.
    prisma.organization.findMany({ select: { id: true, parentId: true } }),
    // Sell-in = committed purchase orders (APPROVED onward — includes fulfilled)
    // that this org placed with its supplier, not just fulfilled sales.
    prisma.purchaseOrder.findMany({
      where: { buyerOrgId: { in: orgIds }, status: { in: COMMITTED_PO }, createdAt: { gte: from, lte: to } },
      include: { items: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { buyerOrgId: { in: orgIds }, status: { in: COMMITTED_PO }, createdAt: { gte: prevFrom, lt: from } },
    }),
    prisma.organization.findMany({
      where: { parentId: { in: orgIds } },
      select: { parentId: true, status: true, isActive: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { sellerOrgId: { in: orgIds }, status: { not: 'DRAFT' } },
      select: { sellerOrgId: true, status: true },
    }),
    prisma.inventory.findMany({
      where: { orgId: { in: orgIds } },
      select: { orgId: true, quantity: true },
    }),
  ]);

  // Sell-in counts purchases an org made from ANYONE above it in the chain, not
  // just its parent: when its parent is deactivated, orders are routed up to the
  // nearest active upline (see nearestActiveSupplier), and those are still the
  // buyer's purchases. Matching the whole upline also keeps history stable —
  // reactivating the parent later can't retroactively un-count an old order.
  const parentOf = new Map(allOrgs.map((o) => [o.id, o.parentId]));
  const uplineOf = (id: string): Set<string> => {
    const out = new Set<string>();
    let pid = parentOf.get(id) ?? null;
    for (let guard = 0; pid && guard < 8 && !out.has(pid); guard++) {
      out.add(pid);
      pid = parentOf.get(pid) ?? null;
    }
    return out;
  };
  const uplineById = new Map(orgIds.map((id) => [id, uplineOf(id)]));
  const fromUpline = (buyerId: string, sellerId: string) => !!uplineById.get(buyerId)?.has(sellerId);

  const byOrg = new Map<string, OrgKpi>();
  for (const o of orgs) {
    byOrg.set(o.id, {
      orgId: o.id,
      orgName: o.name,
      orgType: o.type,
      segment: o.segment,
      revenue: 0,
      prevRevenue: 0,
      growthPct: 0,
      salesVolume: 0,
      target: o.salesTarget,
      targetAttainmentPct: 0,
      activeMembers: 0,
      poFulfillmentRate: 0,
      inventoryTurnover: 0,
    });
  }

  for (const s of currentSales) {
    const k = s.buyerOrgId ? byOrg.get(s.buyerOrgId) : undefined;
    if (!k) continue;
    if (!fromUpline(s.buyerOrgId!, s.sellerOrgId)) continue; // only from its upline
    k.revenue += s.total;
    k.salesVolume += s.items.reduce((u, i) => u + i.quantity, 0);
  }
  for (const s of prevSales) {
    const k = s.buyerOrgId ? byOrg.get(s.buyerOrgId) : undefined;
    if (k && fromUpline(s.buyerOrgId!, s.sellerOrgId)) k.prevRevenue += s.total;
  }
  for (const c of children) {
    const k = c.parentId ? byOrg.get(c.parentId) : undefined;
    if (k && c.status === 'APPROVED' && c.isActive) k.activeMembers += 1;
  }

  const poAgg = new Map<string, { done: number; total: number }>();
  for (const p of pos) {
    const a = poAgg.get(p.sellerOrgId) ?? { done: 0, total: 0 };
    a.total += 1;
    if (p.status === 'FULFILLED' || p.status === 'RECEIVED') a.done += 1;
    poAgg.set(p.sellerOrgId, a);
  }
  const invAgg = new Map<string, number>();
  for (const i of inventory) invAgg.set(i.orgId, (invAgg.get(i.orgId) ?? 0) + i.quantity);

  for (const k of byOrg.values()) {
    k.revenue = round2(k.revenue);
    k.prevRevenue = round2(k.prevRevenue);
    k.growthPct =
      k.prevRevenue > 0
        ? round2(((k.revenue - k.prevRevenue) / k.prevRevenue) * 100)
        : k.revenue > 0
        ? 100
        : 0;
    k.targetAttainmentPct = k.target > 0 ? round2((k.revenue / k.target) * 100) : 0;
    const po = poAgg.get(k.orgId);
    k.poFulfillmentRate = po && po.total > 0 ? round2(po.done / po.total) : 0;
    const invUnits = invAgg.get(k.orgId) ?? 0;
    k.inventoryTurnover = invUnits > 0 ? round2(k.salesVolume / invUnits) : 0;
  }

  return [...byOrg.values()];
}

// Default reporting window: current month-to-date.
export function defaultWindow(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from, to: now };
}

export function parseWindow(query: any): { from: Date; to: Date } {
  const def = defaultWindow();
  const from = query.from ? new Date(query.from) : def.from;
  const to = query.to ? new Date(query.to) : def.to;
  to.setHours(23, 59, 59, 999);
  return { from, to };
}
