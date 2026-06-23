import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { assertInScope, requirePermission } from '../../middleware/rbac';
import { badRequest, notFound } from '../../lib/errors';
import { applyStockMovement } from './inventory.service';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);
inventoryRouter.use(requirePermission('inventory'));

// Resolve which org's inventory to read. Defaults to the requester's own org;
// an upstream role may pass ?orgId= for any org in its scope chain.
function resolveOrgId(req: any): string {
  const orgId = (req.query.orgId as string) || req.auth.orgId;
  assertInScope(req, orgId);
  return orgId;
}

// GET /inventory  — current stock for an org (with low-stock flag)
inventoryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req);
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { type: true, discountRate: true },
    });
    const isPrincipalOrg = org?.type === 'PRINCIPAL';
    // Principal edits its own (production) cost; everyone else's cost is derived
    // from the price they buy at = SRP x (1 - their tier discount).
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    // Show every active product/size — even those without a stock row yet (qty 0).
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ name: 'asc' }, { size: 'asc' }],
    });
    const invRows = await prisma.inventory.findMany({ where: { orgId } });
    const invByProduct = new Map(invRows.map((r) => [r.productId, r]));

    const data = products.map((p) => {
      const inv = invByProduct.get(p.id);
      const qty = inv?.quantity ?? 0;
      const reorderLevel = inv?.reorderLevel ?? null;
      const cost = isPrincipalOrg ? inv?.cost ?? null : r2(p.srp * (1 - (org?.discountRate ?? 0)));
      return {
        id: inv?.id ?? p.id,
        productId: p.id,
        sku: p.sku,
        name: p.name,
        size: p.size,
        category: p.category,
        srp: p.srp,
        cost,
        quantity: qty,
        reorderLevel,
        lowStock: reorderLevel != null && qty <= reorderLevel,
        stockValue: r2(qty * p.srp),
        costValue: cost != null ? r2(qty * cost) : null,
        updatedAt: inv?.updatedAt ?? null,
      };
    });
    res.json({
      orgId,
      items: data,
      // Only the Principal can edit cost, and only on its own inventory.
      costEditable: isPrincipalOrg && orgId === req.auth!.orgId,
      totalValue: r2(data.reduce((s, d) => s + d.stockValue, 0)),
      lowStockCount: data.filter((d) => d.lowStock).length,
    });
  })
);

// GET /inventory/alerts — low-stock items across the requester's scope chain
inventoryRouter.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const rows = await prisma.inventory.findMany({
      where: { orgId: { in: req.scopeOrgIds } },
      include: { product: true, org: { select: { id: true, name: true, type: true } } },
    });
    const low = rows
      .filter((r) => r.reorderLevel != null && r.quantity <= r.reorderLevel)
      .map((r) => ({
        orgId: r.orgId,
        orgName: r.org.name,
        productId: r.productId,
        sku: r.product.sku,
        name: r.product.name,
        quantity: r.quantity,
        reorderLevel: r.reorderLevel,
      }));
    res.json({ alerts: low });
  })
);

// PATCH /inventory/settings — set the unit cost and/or reorder level for an
// item at the requester's own org (creates the inventory row if needed).
const settingsSchema = z.object({
  productId: z.string(),
  cost: z.number().min(0).nullable().optional(),
  reorderLevel: z.number().int().min(0).nullable().optional(),
});
inventoryRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const orgId = req.auth!.orgId;
    const data: { cost?: number | null; reorderLevel?: number | null } = {};
    if (body.cost !== undefined) {
      // Only the Principal sets cost; distributors' cost is derived from discount.
      if (req.auth!.role !== 'PRINCIPAL') throw badRequest('Only the Principal can set cost');
      data.cost = body.cost;
    }
    if (body.reorderLevel !== undefined) data.reorderLevel = body.reorderLevel;
    const item = await prisma.inventory.upsert({
      where: { orgId_productId: { orgId, productId: body.productId } },
      create: { orgId, productId: body.productId, quantity: 0, ...data },
      update: data,
    });
    res.json({ productId: item.productId, cost: item.cost, reorderLevel: item.reorderLevel });
  })
);

// GET /inventory/ledger?productId= — per-SKU stock ledger for an org
inventoryRouter.get(
  '/ledger',
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req);
    const productId = req.query.productId as string | undefined;
    const entries = await prisma.stockLedger.findMany({
      where: { orgId, ...(productId ? { productId } : {}) },
      include: { product: { select: { sku: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ orgId, entries });
  })
);

// POST /inventory/adjust — manual stock adjustment (own org only)
const adjustSchema = z.object({
  productId: z.string(),
  change: z.number().int(),
  reason: z.string().min(1).default('ADJUSTMENT'),
  reorderLevel: z.number().int().min(0).optional(),
});

inventoryRouter.post(
  '/adjust',
  asyncHandler(async (req, res) => {
    const body = adjustSchema.parse(req.body);
    const orgId = req.auth!.orgId;
    const product = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!product) throw notFound('Product not found');

    const balance = await prisma.$transaction(async (tx) => {
      const b = await applyStockMovement(tx, {
        orgId,
        productId: body.productId,
        change: body.change,
        reason: body.reason || 'ADJUSTMENT',
        refType: 'Adjustment',
      });
      if (body.reorderLevel !== undefined) {
        await tx.inventory.update({
          where: { orgId_productId: { orgId, productId: body.productId } },
          data: { reorderLevel: body.reorderLevel },
        });
      }
      return b;
    });

    res.status(201).json({ productId: body.productId, balance });
  })
);
