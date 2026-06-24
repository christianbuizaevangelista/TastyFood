import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { notFound, forbidden } from '../../lib/errors';

export const customersRouter = Router();
customersRouter.use(authenticate);
customersRouter.use(requirePermission('customers'));

// GET /customers — end-customers within the requester's chain (a Reseller sees
// its own; upstream tiers see all customers served by their downline).
customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.scopeOrgIds!;
    const search = (req.query.search as string | undefined)?.trim().toLowerCase();
    const customers = await prisma.customer.findMany({
      where: { ownerOrgId: { in: scope } },
      include: {
        ownerOrg: { select: { id: true, name: true, type: true } },
        sales: { select: { total: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const data = customers
      .filter((c) => !search || [c.name, c.phone, c.address].some((v) => v && v.toLowerCase().includes(search)))
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        note: c.note,
        owner: c.ownerOrg,
        salesCount: c.sales.length,
        totalAmount: r2(c.sales.reduce((s, x) => s + x.total, 0)),
        createdAt: c.createdAt,
      }));
    res.json({ customers: data });
  })
);

// GET /customers/:id — customer detail + purchase history (scope-checked).
customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        ownerOrg: { select: { id: true, name: true, type: true } },
        sales: {
          orderBy: { createdAt: 'desc' },
          include: { items: { include: { product: { select: { name: true, sku: true } } } } },
        },
      },
    });
    if (!c) throw notFound('Customer not found');
    if (!req.scopeOrgIds!.includes(c.ownerOrgId)) throw forbidden('Customer is outside your network');
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    res.json({
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      note: c.note,
      owner: c.ownerOrg,
      totalAmount: r2(c.sales.reduce((s, x) => s + x.total, 0)),
      sales: c.sales.map((s) => ({
        id: s.id,
        number: s.number,
        total: s.total,
        createdAt: s.createdAt,
        items: s.items.map((i) => ({ name: i.product.name, sku: i.product.sku, quantity: i.quantity, lineTotal: i.lineTotal })),
      })),
    });
  })
);

const upsertSchema = z.object({
  name: z.string().min(1).max(160),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  note: z.string().max(500).optional(),
});

// POST /customers — add an end-customer owned by the requester's org.
customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = upsertSchema.parse(req.body);
    const c = await prisma.customer.create({
      data: {
        name: body.name,
        phone: body.phone ?? null,
        address: body.address ?? null,
        note: body.note ?? null,
        ownerOrgId: req.auth!.orgId,
        createdById: req.auth!.sub,
      },
      select: { id: true, name: true, phone: true, address: true, note: true },
    });
    res.status(201).json(c);
  })
);

// PATCH /customers/:id — edit a customer (owner only).
customersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Customer not found');
    if (existing.ownerOrgId !== req.auth!.orgId) throw forbidden('You can only edit your own customers');
    const body = upsertSchema.partial().parse(req.body);
    const c = await prisma.customer.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.address !== undefined ? { address: body.address || null } : {}),
        ...(body.note !== undefined ? { note: body.note || null } : {}),
      },
      select: { id: true, name: true, phone: true, address: true, note: true },
    });
    res.json(c);
  })
);

// DELETE /customers/:id — remove a customer (owner only). Sales keep their snapshot name.
customersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Customer not found');
    if (existing.ownerOrgId !== req.auth!.orgId) throw forbidden('You can only delete your own customers');
    await prisma.sale.updateMany({ where: { customerId: req.params.id }, data: { customerId: null } });
    await prisma.customer.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  })
);
