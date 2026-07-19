import { prisma } from './prisma';

// Drop-ship ships straight from the Principal to an end recipient, bypassing the
// buyer's own supply chain. That only makes sense for destinations the buyer
// does NOT already cover: inside its own area it should stock and deliver
// normally (Regular / TRADE). This module decides whether a destination falls
// inside a buyer's territory.

export interface Destination {
  province?: string | null;
  city?: string | null;
  barangay?: string | null;
}

// PSGC names vary in punctuation and case between the picker and how a
// territory was named ("City of Trece Martires", "Zone I (Pob.)"), so compare on
// a squashed form rather than raw equality.
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')       // drop parenthetical qualifiers
    .replace(/\b(city|municipality) of\b/g, ' ')
    .replace(/\bcity\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = norm(a);
  const nb = norm(b);
  return na.length > 0 && na === nb;
}

export interface TerritoryBlock {
  territoryName: string;
  level: string;
  orgName: string;
  /** Which part of the destination matched, for the error message. */
  matched: string;
}

/**
 * Returns the territory that makes this destination off-limits for drop-ship,
 * or null if the destination is outside every area the buyer covers.
 *
 * Checked against the buyer's own territory AND the territories of every org
 * below it, since those are equally "within their area".
 *
 * Matching is hierarchical on purpose: barangay and city names repeat across the
 * Philippines (dozens of "Poblacion", several "San Jose"), so a name only counts
 * as a match when its parent matches too.
 */
export async function findBlockingTerritory(
  buyerOrgId: string,
  dest: Destination
): Promise<TerritoryBlock | null> {
  if (!dest.province && !dest.city && !dest.barangay) return null;

  // The buyer plus everything under it.
  const orgIds = new Set<string>([buyerOrgId]);
  let frontier = [buyerOrgId];
  for (let guard = 0; frontier.length > 0 && guard < 8; guard++) {
    const children = await prisma.organization.findMany({
      where: { parentId: { in: frontier }, archivedAt: null },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !orgIds.has(id));
    frontier.forEach((id) => orgIds.add(id));
  }

  const territories = await prisma.territory.findMany({
    where: { assignedOrgId: { in: [...orgIds] } },
    select: {
      name: true,
      level: true,
      assignedOrg: { select: { name: true } },
      parent: { select: { name: true, level: true } },
    },
  });

  for (const t of territories) {
    const orgName = t.assignedOrg?.name ?? 'a distributor';
    if (t.level === 'PROVINCE' && sameName(t.name, dest.province)) {
      return { territoryName: t.name, level: t.level, orgName, matched: dest.province! };
    }
    if (t.level === 'CITY' && sameName(t.name, dest.city)) {
      // Only a real match when the province agrees (city names repeat).
      // If the territory has no province parent recorded, fall back to the city
      // match alone rather than letting the order through unchecked.
      const parentIsProvince = t.parent?.level === 'PROVINCE';
      if (!parentIsProvince || sameName(t.parent?.name, dest.province)) {
        return { territoryName: t.name, level: t.level, orgName, matched: dest.city! };
      }
    }
    if (t.level === 'BARANGAY' && sameName(t.name, dest.barangay)) {
      const parentIsCity = t.parent?.level === 'CITY';
      if (!parentIsCity || sameName(t.parent?.name, dest.city)) {
        return { territoryName: t.name, level: t.level, orgName, matched: dest.barangay! };
      }
    }
  }
  return null;
}

export function dropshipBlockedMessage(
  b: TerritoryBlock,
  isOwnTerritory: boolean,
  dest: Destination
): string {
  // Name the place the user actually chose ("Tanza, Cavite"), not just the part
  // that happened to match, or the message reads as a tautology.
  const where = [dest.barangay, dest.city, dest.province].filter(Boolean).join(', ') || b.matched;
  const who = isOwnTerritory ? 'your own territory' : `${b.orgName}'s territory, which is under you`;
  return `${where} is inside ${who} (${b.territoryName}). Drop-ship is only for areas you don't already cover — please use Regular distribution for this order.`;
}
