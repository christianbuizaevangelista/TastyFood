import { prisma } from '../../lib/prisma';

export interface OrgKpi {
  orgId: string;
  orgName: string;
  orgType: string;
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
// equally-sized immediately-preceding window for growth.
export async function computeOrgKpis(
  orgIds: string[],
  from: Date,
  to: Date
): Promise<OrgKpi[]> {
  if (orgIds.length === 0) return [];

  const windowMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - windowMs);

  const [orgs, currentSales, prevSales, children, pos, inventory] = await Promise.all([
    prisma.organization.findMany({ where: { id: { in: orgIds } } }),
    prisma.sale.findMany({
      where: { sellerOrgId: { in: orgIds }, createdAt: { gte: from, lte: to } },
      include: { items: true },
    }),
    prisma.sale.findMany({
      where: { sellerOrgId: { in: orgIds }, createdAt: { gte: prevFrom, lt: from } },
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

  const byOrg = new Map<string, OrgKpi>();
  for (const o of orgs) {
    byOrg.set(o.id, {
      orgId: o.id,
      orgName: o.name,
      orgType: o.type,
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
    const k = byOrg.get(s.sellerOrgId);
    if (!k) continue;
    k.revenue += s.total;
    k.salesVolume += s.items.reduce((u, i) => u + i.quantity, 0);
  }
  for (const s of prevSales) {
    const k = byOrg.get(s.sellerOrgId);
    if (k) k.prevRevenue += s.total;
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
