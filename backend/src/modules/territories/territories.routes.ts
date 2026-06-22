import { Router } from 'express';
import { OrgType, TerritoryLevel } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';

export const territoriesRouter = Router();
territoriesRouter.use(authenticate);

// Which territory level a given org type occupies.
export const LEVEL_FOR_TYPE: Partial<Record<OrgType, TerritoryLevel>> = {
  PROVINCIAL: 'PROVINCE',
  CITY: 'CITY',
  RESELLER: 'BARANGAY',
};

interface TerritoryRow {
  id: string;
  name: string;
  level: TerritoryLevel;
  parentId: string | null;
  assignedOrgId: string | null;
  assignedOrg: { id: string; name: string; type: OrgType; status: string } | null;
}

// Returns the territories the requester may see (Principal: everything; others:
// their own assigned territory plus all descendants), and the root ids.
async function getVisible(req: any): Promise<{ visible: TerritoryRow[]; rootIds: string[] }> {
  const all = (await prisma.territory.findMany({
    include: { assignedOrg: { select: { id: true, name: true, type: true, status: true } } },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
  })) as unknown as TerritoryRow[];

  if (req.auth.role === 'PRINCIPAL') {
    return { visible: all, rootIds: all.filter((t) => !t.parentId).map((t) => t.id) };
  }

  const mine = all.find((t) => t.assignedOrgId === req.auth.orgId);
  if (!mine) return { visible: [], rootIds: [] };

  const keep = new Set<string>();
  const stack = [mine.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (keep.has(id)) continue;
    keep.add(id);
    all.filter((t) => t.parentId === id).forEach((c) => stack.push(c.id));
  }
  return { visible: all.filter((t) => keep.has(t.id)), rootIds: [mine.id] };
}

const isVacant = (t: TerritoryRow) => t.level !== 'REGION' && !t.assignedOrgId;

// GET /territories — nested tree scoped to the requester, plus vacancy summary.
territoriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { visible, rootIds } = await getVisible(req);

    const nodes = new Map(
      visible.map((t) => [
        t.id,
        {
          id: t.id,
          name: t.name,
          level: t.level,
          vacant: isVacant(t),
          assignedOrg: t.assignedOrg,
          children: [] as any[],
        },
      ])
    );
    const tree: any[] = [];
    for (const t of visible) {
      const node = nodes.get(t.id)!;
      if (t.parentId && nodes.has(t.parentId)) nodes.get(t.parentId)!.children.push(node);
      else if (rootIds.includes(t.id)) tree.push(node);
    }

    const summary = {
      vacant: { PROVINCE: 0, CITY: 0, BARANGAY: 0 } as Record<string, number>,
      total: { PROVINCE: 0, CITY: 0, BARANGAY: 0 } as Record<string, number>,
    };
    for (const t of visible) {
      if (t.level in summary.total) {
        summary.total[t.level] += 1;
        if (!t.assignedOrgId) summary.vacant[t.level] += 1;
      }
    }

    res.json({ tree, summary });
  })
);

// GET /territories/vacant?level=CITY — flat list of vacant territories in scope.
territoriesRouter.get(
  '/vacant',
  asyncHandler(async (req, res) => {
    const { visible } = await getVisible(req);
    const level = req.query.level as TerritoryLevel | undefined;
    const byId = new Map(visible.map((t) => [t.id, t]));
    const vacant = visible
      .filter((t) => isVacant(t) && (!level || t.level === level))
      .map((t) => ({
        id: t.id,
        name: t.name,
        level: t.level,
        parentId: t.parentId,
        parentName: t.parentId ? byId.get(t.parentId)?.name ?? null : null,
      }));
    res.json({ vacant });
  })
);
