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
