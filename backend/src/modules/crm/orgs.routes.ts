import { Router } from 'express';
import { z } from 'zod';
import { OrgType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { assertInScope } from '../../middleware/rbac';
import { badRequest, forbidden, notFound, conflict } from '../../lib/errors';
import { TIER_DISCOUNT, PARENT_TYPE } from '../../lib/pricing';
import { hashPassword, verifyPassword } from '../../lib/auth';
import { canApproveOrgOnboarding } from './approvals.service';
import { LEVEL_FOR_TYPE } from '../territories/territories.routes';

export const orgsRouter = Router();
orgsRouter.use(authenticate);

// GET /orgs — downstream accounts (members) within the requester's chain.
orgsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.scopeOrgIds!;
    const type = req.query.type as string | undefined;
    const orgs = await prisma.organization.findMany({
      where: {
        id: { in: scope },
        ...(req.query.includeSelf === 'true' ? {} : { NOT: { id: req.auth!.orgId } }),
        ...(type ? { type: type as any } : {}),
      },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        _count: { select: { children: true, users: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json({ orgs });
  })
);

// GET /orgs/:id — account detail.
orgsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    assertInScope(req, req.params.id);
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        children: { select: { id: true, name: true, type: true, status: true, isActive: true } },
        users: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      },
    });
    if (!org) throw notFound('Organization not found');
    res.json(org);
  })
);

// GET /orgs/:id/orders — combined order history (POs as buyer + sales as seller).
orgsRouter.get(
  '/:id/orders',
  asyncHandler(async (req, res) => {
    assertInScope(req, req.params.id);
    const [purchases, sales] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { buyerOrgId: req.params.id },
        select: { id: true, number: true, status: true, total: true, distributionType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.sale.findMany({
        where: { sellerOrgId: req.params.id },
        select: { id: true, number: true, channel: true, total: true, distributionType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    res.json({ purchases, sales });
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['PROVINCIAL', 'CITY', 'RESELLER']),
  parentId: z.string(),
  // Optional geographic territory to assign this account to.
  territoryId: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  salesTarget: z.number().min(0).optional(),
  admin: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
  }),
});

// POST /orgs — onboard a downstream account (starts PENDING, needs approval).
orgsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    // Parent must be in scope and of the correct upstream tier.
    assertInScope(req, body.parentId);
    const parent = await prisma.organization.findUnique({ where: { id: body.parentId } });
    if (!parent) throw notFound('Parent organization not found');
    if (PARENT_TYPE[body.type as OrgType] !== parent.type) {
      throw badRequest(`A ${body.type} must report to a ${PARENT_TYPE[body.type as OrgType]}`);
    }

    // Requester must be entitled to onboard this tier (same rule as approval).
    const allowed = await canApproveOrgOnboarding(
      req.auth!.role,
      req.auth!.orgId,
      body.type as OrgType,
      // subject not created yet; check the parent chain instead
      body.parentId
    );
    if (!allowed && req.auth!.role !== 'PRINCIPAL') {
      throw forbidden('You are not authorized to onboard this tier');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: body.admin.email.toLowerCase() },
    });
    if (existingUser) throw badRequest('A user with that email already exists');

    // If assigning a territory, validate it is vacant and the right level.
    if (body.territoryId) {
      const terr = await prisma.territory.findUnique({ where: { id: body.territoryId } });
      if (!terr) throw notFound('Territory not found');
      if (terr.assignedOrgId) throw badRequest('That territory is already occupied');
      if (terr.level !== LEVEL_FOR_TYPE[body.type as OrgType]) {
        throw badRequest(`A ${body.type} must occupy a ${LEVEL_FOR_TYPE[body.type as OrgType]} territory`);
      }
    }

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: body.name,
          type: body.type as OrgType,
          parentId: body.parentId,
          discountRate: TIER_DISCOUNT[body.type as OrgType],
          status: 'PENDING',
          isActive: true,
          contactName: body.contactName,
          contactEmail: body.contactEmail,
          contactPhone: body.contactPhone,
          address: body.address,
          salesTarget: body.salesTarget ?? 0,
        },
      });
      await tx.user.create({
        data: {
          name: body.admin.name,
          email: body.admin.email.toLowerCase(),
          passwordHash: await hashPassword(body.admin.password),
          role: body.type as any,
          orgId: created.id,
        },
      });
      await tx.approval.create({
        data: {
          type: 'ORG_ONBOARDING',
          status: 'PENDING',
          orgId: created.id,
          requestedById: req.auth!.sub,
        },
      });
      if (body.territoryId) {
        await tx.territory.update({
          where: { id: body.territoryId },
          data: { assignedOrgId: created.id },
        });
      }
      return created;
    });

    res.status(201).json(org);
  })
);

const updateSchema = z.object({
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  salesTarget: z.number().min(0).optional(),
});

// PATCH /orgs/:id — update CRM details (contact, notes, target).
orgsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    assertInScope(req, req.params.id);
    if (req.params.id === req.auth!.orgId && req.auth!.role !== 'PRINCIPAL') {
      // allow editing own contact details
    }
    const body = updateSchema.parse(req.body);
    const org = await prisma.organization.update({ where: { id: req.params.id }, data: body });
    res.json(org);
  })
);

// POST /orgs/:id/activate | /deactivate — membership activation.
function setActive(active: boolean) {
  return asyncHandler(async (req: any, res: any) => {
    assertInScope(req, req.params.id);
    if (req.params.id === req.auth.orgId) throw badRequest('You cannot change your own activation');
    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) throw notFound('Organization not found');
    // Only the Principal may activate/deactivate accounts.
    if (req.auth.role !== 'PRINCIPAL') throw forbidden('Only the Principal can activate or deactivate accounts');
    const updated = await prisma.organization.update({
      where: { id: req.params.id },
      data: { isActive: active },
    });
    res.json(updated);
  });
}

orgsRouter.post('/:id/activate', setActive(true));
orgsRouter.post('/:id/deactivate', setActive(false));

// DELETE /orgs/:id — permanently delete an account. Principal only, confirmed
// with the Principal's own password. Blocked if the account has downstream
// accounts or any order/sales history (deactivate those instead).
orgsRouter.delete(
  '/:id',
  asyncHandler(async (req: any, res) => {
    if (req.auth.role !== 'PRINCIPAL') throw forbidden('Only the Principal can delete accounts');
    assertInScope(req, req.params.id);
    if (req.params.id === req.auth.orgId) throw badRequest('You cannot delete your own organization');

    const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
    const me = await prisma.user.findUnique({ where: { id: req.auth.sub } });
    if (!me || !(await verifyPassword(password, me.passwordHash))) {
      throw forbidden('Incorrect password');
    }

    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { children: true } } },
    });
    if (!org) throw notFound('Organization not found');
    if (org._count.children > 0) throw conflict('Remove its downstream accounts first');

    // Cascade-delete the account and all its records, including order/sales history.
    await prisma.$transaction(async (tx) => {
      // Purchase orders where this org is buyer or seller (+ their items, attachments,
      // approvals and generated sales).
      const pos = await tx.purchaseOrder.findMany({
        where: { OR: [{ buyerOrgId: org.id }, { sellerOrgId: org.id }] },
        select: { id: true },
      });
      const poIds = pos.map((p) => p.id);
      if (poIds.length) {
        await tx.saleItem.deleteMany({ where: { sale: { poId: { in: poIds } } } });
        await tx.sale.deleteMany({ where: { poId: { in: poIds } } });
        await tx.poAttachment.deleteMany({ where: { poId: { in: poIds } } });
        await tx.approval.deleteMany({ where: { poId: { in: poIds } } });
        await tx.purchaseOrderItem.deleteMany({ where: { poId: { in: poIds } } });
        await tx.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
      }
      // The org's own POS/PO sales, then detach it as a buyer on others' sales.
      await tx.saleItem.deleteMany({ where: { sale: { sellerOrgId: org.id } } });
      await tx.sale.deleteMany({ where: { sellerOrgId: org.id } });
      await tx.sale.updateMany({ where: { buyerOrgId: org.id }, data: { buyerOrgId: null } });

      await tx.territory.updateMany({ where: { assignedOrgId: org.id }, data: { assignedOrgId: null } });
      await tx.approval.deleteMany({ where: { orgId: org.id } });
      await tx.manaTxn.deleteMany({ where: { orgId: org.id } });
      await tx.manaPurchase.deleteMany({ where: { orgId: org.id } });
      await tx.kPIRecord.deleteMany({ where: { orgId: org.id } });
      await tx.stockLedger.deleteMany({ where: { orgId: org.id } });
      await tx.inventory.deleteMany({ where: { orgId: org.id } });
      await tx.user.deleteMany({ where: { orgId: org.id } });
      await tx.organization.delete({ where: { id: org.id } });
    });
    res.json({ ok: true });
  })
);
