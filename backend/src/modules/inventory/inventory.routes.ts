import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { assertInScope } from '../../middleware/rbac';
import { badRequest, notFound } from '../../lib/errors';
import { applyStockMovement } from './inventory.service';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

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
    const rows = await prisma.inventory.findMany({
      where: { orgId },
      include: { product: true },
      orderBy: { product: { name: 'asc' } },
    });
    const data = rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      sku: r.product.sku,
      name: r.product.name,
      category: r.product.category,
      srp: r.product.srp,
      quantity: r.quantity,
      reorderLevel: r.reorderLevel,
      lowStock: r.quantity <= r.reorderLevel,
      stockValue: Math.round(r.quantity * r.product.srp * 100) / 100,
      updatedAt: r.updatedAt,
    }));
    res.json({
      orgId,
      items: data,
      totalValue: Math.round(data.reduce((s, d) => s + d.stockValue, 0) * 100) / 100,
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
      .filter((r) => r.quantity <= r.reorderLevel)
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
