import { Router } from 'express';
import { z } from 'zod';
import { OrgType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { assertInScope } from '../../middleware/rbac';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { TIER_DISCOUNT, PARENT_TYPE } from '../../lib/pricing';
import { hashPassword } from '../../lib/auth';
import { canApproveOrgOnboarding } from './approvals.service';

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
    // Only upstream roles may toggle membership.
    if (req.auth.role === 'RESELLER') throw forbidden('Resellers cannot change membership');
    const updated = await prisma.organization.update({
      where: { id: req.params.id },
      data: { isActive: active },
    });
    res.json(updated);
  });
}

orgsRouter.post('/:id/activate', setActive(true));
orgsRouter.post('/:id/deactivate', setActive(false));
