import { prisma } from './prisma';

/**
 * Returns the set of org ids the given org is allowed to see: itself plus all
 * descendants in the distribution hierarchy. Every data query in the app is
 * scoped through this so a requester only ever sees its own chain.
 */
export async function getDescendantOrgIds(rootOrgId: string): Promise<string[]> {
  const result = new Set<string>([rootOrgId]);
  let frontier = [rootOrgId];

  while (frontier.length > 0) {
    const children = await prisma.organization.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    const next: string[] = [];
    for (const c of children) {
      if (!result.has(c.id)) {
        result.add(c.id);
        next.push(c.id);
      }
    }
    frontier = next;
  }

  return [...result];
}

/** Returns the chain of ancestor org ids above the given org (parent, grandparent, … up to the Principal). */
export async function getAncestorOrgIds(orgId: string): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = await prisma.organization.findUnique({ where: { id: orgId }, select: { parentId: true } });
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    ids.push(current.parentId);
    current = await prisma.organization.findUnique({ where: { id: current.parentId }, select: { parentId: true } });
  }
  return ids;
}

/** Keeps only the org ids that are NOT archived (deleted). Used to drop deleted accounts from rankings/lists. */
export async function excludeArchived(orgIds: string[]): Promise<string[]> {
  if (orgIds.length === 0) return [];
  const active = await prisma.organization.findMany({
    where: { id: { in: orgIds }, archivedAt: null },
    select: { id: true },
  });
  return active.map((o) => o.id);
}
