import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireOwner, requireRole } from '../../middleware/rbac';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { env } from '../../lib/env';
import { sendStaffInviteEmail } from '../../lib/email';

export const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.use(requireRole('PRINCIPAL')); // staff/admin management is Principal-only
usersRouter.use(requireOwner); // and only the Principal owner, not their own staff

// Grantable permission keys (modules a staff user can be given access to).
export const PERMISSIONS = [
  'dashboard',
  'inventory',
  'purchase-orders',
  'pos',
  'sales',
  'kpi',
  'crm',
  'approvals',
  'products',
  'structure',
  'mana',
  'materials',
  'customers',
  'referrals',
] as const;

function inviteLink(token: string) {
  return `${env.clientOrigin.replace(/\/$/, '')}/set-password?token=${token}`;
}

// GET /users — staff in the owner's org.
usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { orgId: req.auth!.orgId },
      select: {
        id: true,
        name: true,
        email: true,
        isOwner: true,
        isActive: true,
        permissions: true,
        inviteToken: true,
        createdAt: true,
      },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({
      permissions: PERMISSIONS,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isOwner: u.isOwner,
        isActive: u.isActive,
        permissions: u.permissions,
        pending: !!u.inviteToken, // hasn't set a password yet
      })),
    });
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});

// POST /users — add a staff user; returns an invite link to share with them.
usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) {
      throw badRequest('A user with that email already exists');
    }
    const token = crypto.randomBytes(24).toString('hex');
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email,
        role: req.auth!.role,
        orgId: req.auth!.orgId,
        isOwner: false,
        isActive: false,
        permissions: body.permissions,
        passwordHash: null,
        inviteToken: token,
        inviteExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      select: { id: true, name: true, email: true, permissions: true },
    });
    // Email the staff their set-password invite.
    const owner = await prisma.organization.findUnique({ where: { id: req.auth!.orgId }, select: { name: true } });
    const invite = await sendStaffInviteEmail({ to: email, name: body.name, orgName: owner?.name ?? 'Your team', link: inviteLink(token) });
    res.status(201).json({ ...user, pending: true, invite });
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /users/:id — update a staff member's name/permissions/active state.
usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.orgId !== req.auth!.orgId) throw notFound('User not found');
    if (target.isOwner) throw forbidden('Cannot modify the owner');
    const body = updateSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: body,
      select: { id: true, name: true, permissions: true, isActive: true },
    });
    res.json(updated);
  })
);

// POST /users/:id/resend — re-email the set-password invite to a pending staff.
usersRouter.post(
  '/:id/resend',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { org: { select: { name: true } } },
    });
    if (!target || target.orgId !== req.auth!.orgId) throw notFound('User not found');
    if (target.passwordHash) throw badRequest('This user has already set their password');
    const token = crypto.randomBytes(24).toString('hex');
    await prisma.user.update({
      where: { id: target.id },
      data: { inviteToken: token, inviteExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    const invite = await sendStaffInviteEmail({ to: target.email, name: target.name, orgName: target.org.name, link: inviteLink(token) });
    res.json({ ok: true, invite });
  })
);

// DELETE /users/:id — remove a staff member.
usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.orgId !== req.auth!.orgId) throw notFound('User not found');
    if (target.isOwner) throw forbidden('Cannot delete the owner');
    if (target.id === req.auth!.sub) throw badRequest('You cannot delete yourself');
    await prisma.user.delete({ where: { id: target.id } });
    res.json({ ok: true });
  })
);
