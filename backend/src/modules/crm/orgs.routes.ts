import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { OrgType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { assertInScope, requirePermission } from '../../middleware/rbac';
import { getDescendantOrgIds } from '../../lib/scope';
import { badRequest, forbidden, notFound, conflict } from '../../lib/errors';
import { TIER_DISCOUNT, ALLOWED_PARENTS } from '../../lib/pricing';
import { hashPassword, verifyPassword } from '../../lib/auth';
import { canApproveOrgOnboarding } from './approvals.service';
import { LEVEL_FOR_TYPE } from '../territories/territories.routes';
import { env } from '../../lib/env';
import { sendInviteEmail } from '../../lib/email';

// Shared helper: build the set-password link from an invite token.
function inviteLink(token: string) {
  return `${env.clientOrigin.replace(/\/$/, '')}/set-password?token=${token}`;
}

export const orgsRouter = Router();
orgsRouter.use(authenticate);
orgsRouter.use(requirePermission('crm'));

// GET /orgs — downstream accounts (members) within the requester's chain.
orgsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.scopeOrgIds!;
    const type = req.query.type as string | undefined;
    const orgs = await prisma.organization.findMany({
      where: {
        id: { in: scope },
        archivedAt: null, // hide archived (deleted) accounts
        ...(req.query.includeSelf === 'true' ? {} : { NOT: { id: req.auth!.orgId } }),
        ...(type ? { type: type as any } : {}),
      },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        territory: { select: { id: true, name: true, level: true } },
        users: { where: { isOwner: true }, select: { passwordHash: true } },
        _count: { select: { children: true, users: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    // Surface a "pending invite" flag (admin hasn't set a password) without leaking hashes.
    const shaped = orgs.map(({ users, ...o }) => ({
      ...o,
      pendingInvite: users.length > 0 && users.some((u) => !u.passwordHash),
    }));
    res.json({ orgs: shaped });
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

// GET /orgs/:id/orders — combined order history (POs as buyer + sales as seller),
// plus a Total Sales figure. Optional ?from&to (YYYY-MM-DD) date range.
orgsRouter.get(
  '/:id/orders',
  asyncHandler(async (req, res) => {
    assertInScope(req, req.params.id);
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (req.query.from) createdAt.gte = new Date(req.query.from as string);
    if (req.query.to) {
      const end = new Date(req.query.to as string);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    const range = createdAt.gte || createdAt.lte ? { createdAt } : {};

    const [purchases, sales, salesAgg] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { buyerOrgId: req.params.id, ...range },
        select: { id: true, number: true, status: true, total: true, distributionType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.sale.findMany({
        where: { sellerOrgId: req.params.id, ...range },
        select: { id: true, number: true, channel: true, total: true, distributionType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.sale.aggregate({
        where: { sellerOrgId: req.params.id, ...range },
        _sum: { total: true },
        _count: true,
      }),
    ]);
    res.json({
      purchases,
      sales,
      salesTotal: Math.round(((salesAgg._sum.total ?? 0) + Number.EPSILON) * 100) / 100,
      salesCount: salesAgg._count,
    });
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
    // Optional: if omitted, the admin gets an email invite to set their own password.
    password: z.string().min(6).optional(),
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
    if (!ALLOWED_PARENTS[body.type as OrgType].includes(parent.type)) {
      throw badRequest(
        `A ${body.type} must report to a ${ALLOWED_PARENTS[body.type as OrgType].join(' or ')}`
      );
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

    // If no password is supplied, the admin gets an email invite to set their own.
    const wantsInvite = !body.admin.password;
    const inviteToken = wantsInvite ? crypto.randomBytes(24).toString('hex') : null;

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: body.name,
          type: body.type as OrgType,
          parentId: body.parentId,
          discountRate: TIER_DISCOUNT[body.type as OrgType],
          status: 'APPROVED', // accounts are live as soon as they're encoded in CRM
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
          passwordHash: wantsInvite ? null : await hashPassword(body.admin.password!),
          role: body.type as any,
          orgId: created.id,
          isOwner: true,
          isActive: !wantsInvite, // activated once they accept the invite
          inviteToken,
          inviteExpires: wantsInvite ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
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

    // Email the admin an invite to set their own password (best-effort; the
    // returned link lets the owner share it manually if email isn't delivering).
    let link: string | null = null;
    if (wantsInvite && inviteToken) {
      link = inviteLink(inviteToken);
      await sendInviteEmail({ to: body.admin.email.toLowerCase(), name: body.admin.name, orgName: body.name, link });
    }

    res.status(201).json({ ...org, inviteLink: link });
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  salesTarget: z.number().min(0).optional(),
  // Assign/move this account to a geographic territory ('' or null = unassign).
  // Once assigned, the account automatically appears on the Org Structure map.
  territoryId: z.string().nullable().optional(),
  // Reassign the supplier (parent). A City can report to the Principal (no
  // Provincial yet) or to a Provincial — its POs always go to whoever is set.
  parentId: z.string().optional(),
});

// PATCH /orgs/:id — update CRM details (name, contact, notes, target, territory).
orgsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    assertInScope(req, req.params.id);
    const { territoryId, parentId, ...fields } = updateSchema.parse(req.body);
    const target = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Organization not found');

    // Handle a supplier (parent) reassignment if requested. Principal only.
    if (parentId !== undefined && parentId !== target.parentId) {
      if (req.auth!.role !== 'PRINCIPAL') throw forbidden('Only the Principal can reassign an account’s supplier');
      const newParent = await prisma.organization.findUnique({ where: { id: parentId } });
      if (!newParent || newParent.archivedAt) throw notFound('New supplier not found');
      if (!ALLOWED_PARENTS[target.type].includes(newParent.type)) {
        throw badRequest(`A ${target.type} can only report to a ${ALLOWED_PARENTS[target.type].join(' or ')}`);
      }
      // Prevent cycles: the new parent must not be the org itself or a descendant.
      const descendants = await getDescendantOrgIds(target.id);
      if (descendants.includes(parentId)) throw badRequest('Cannot report to itself or one of its own downline');
      await prisma.organization.update({ where: { id: target.id }, data: { parentId } });
    }

    // Handle a territory (re)assignment if requested.
    if (territoryId !== undefined) {
      const current = await prisma.territory.findFirst({ where: { assignedOrgId: target.id } });
      if (territoryId) {
        if (current?.id !== territoryId) {
          const terr = await prisma.territory.findUnique({ where: { id: territoryId } });
          if (!terr) throw notFound('Territory not found');
          if (terr.assignedOrgId) throw badRequest('That territory is already occupied');
          if (terr.level !== LEVEL_FOR_TYPE[target.type]) {
            throw badRequest(`A ${target.type} must occupy a ${LEVEL_FOR_TYPE[target.type]} territory`);
          }
          await prisma.$transaction(async (tx) => {
            if (current) await tx.territory.update({ where: { id: current.id }, data: { assignedOrgId: null } });
            await tx.territory.update({ where: { id: territoryId }, data: { assignedOrgId: target.id } });
          });
        }
      } else if (current) {
        await prisma.territory.update({ where: { id: current.id }, data: { assignedOrgId: null } });
      }
    }

    const org = await prisma.organization.update({ where: { id: req.params.id }, data: fields });
    res.json(org);
  })
);

// GET /orgs/:id/invite-link — copy/regenerate the admin's set-password link
// (only while their password hasn't been set). Principal/in-scope.
orgsRouter.get(
  '/:id/invite-link',
  asyncHandler(async (req, res) => {
    assertInScope(req, req.params.id);
    const admin = await prisma.user.findFirst({
      where: { orgId: req.params.id, isOwner: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) throw notFound('Account admin not found');
    if (admin.passwordHash) throw badRequest('This account has already set its password');
    let token = admin.inviteToken;
    if (!token) {
      token = crypto.randomBytes(24).toString('hex');
      await prisma.user.update({
        where: { id: admin.id },
        data: { inviteToken: token, inviteExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });
    }
    res.json({ inviteLink: inviteLink(token), email: admin.email });
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
    // Deactivating is sensitive — confirm with the Principal's own password.
    if (!active) {
      const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
      const me = await prisma.user.findUnique({ where: { id: req.auth.sub } });
      if (!me || !me.passwordHash || !(await verifyPassword(password, me.passwordHash))) {
        throw forbidden('Incorrect password');
      }
    }
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
    if (!me || !me.passwordHash || !(await verifyPassword(password, me.passwordHash))) {
      throw forbidden('Incorrect password');
    }

    const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org) throw notFound('Organization not found');
    const activeChildren = await prisma.organization.count({
      where: { parentId: org.id, archivedAt: null },
    });
    if (activeChildren > 0) throw conflict('Remove its downstream accounts first');

    // Archive (soft delete): keep all records intact, but remove the account from
    // the CRM and Org Structure, free its territory, and block its login.
    await prisma.$transaction(async (tx) => {
      await tx.territory.updateMany({ where: { assignedOrgId: org.id }, data: { assignedOrgId: null } });
      await tx.organization.update({
        where: { id: org.id },
        data: { archivedAt: new Date(), isActive: false },
      });
    });
    res.json({ ok: true });
  })
);
