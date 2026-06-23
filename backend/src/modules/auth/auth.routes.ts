import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { signToken, verifyPassword } from '../../lib/auth';
import { unauthorized, forbidden } from '../../lib/errors';
import { authenticate } from '../../middleware/auth';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { org: true },
    });
    if (!user) throw unauthorized('Invalid email or password');
    if (!user.passwordHash) throw forbidden('Please set your password using your invite link first');
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }
    if (user.org.archivedAt) throw forbidden('This account no longer exists');
    if (!user.isActive) throw forbidden('User account is deactivated');
    if (user.org.status !== 'APPROVED' || !user.org.isActive) {
      throw forbidden('Organization is not active. Contact your approver.');
    }

    const token = signToken({
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      name: user.name,
      email: user.email,
      isOwner: user.isOwner,
      permissions: user.permissions,
    });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isOwner: user.isOwner,
        permissions: user.permissions,
        org: {
          id: user.org.id,
          name: user.org.name,
          type: user.org.type,
          discountRate: user.org.discountRate,
        },
      },
    });
  })
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.sub },
      include: { org: true },
    });
    if (!user) throw unauthorized();
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isOwner: user.isOwner,
      permissions: user.permissions,
      org: {
        id: user.org.id,
        name: user.org.name,
        type: user.org.type,
        discountRate: user.org.discountRate,
        parentId: user.org.parentId,
      },
    });
  })
);

// GET /auth/invite/:token — invite info for the set-password page (public).
authRouter.get(
  '/invite/:token',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { inviteToken: req.params.token },
      include: { org: { select: { name: true } } },
    });
    if (!user || !user.inviteExpires || user.inviteExpires < new Date()) {
      throw forbidden('This invite link is invalid or has expired');
    }
    res.json({ name: user.name, email: user.email, orgName: user.org.name });
  })
);

// POST /auth/accept-invite — staff sets their own password to activate.
authRouter.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const { token, password } = z
      .object({ token: z.string().min(1), password: z.string().min(6) })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { inviteToken: token } });
    if (!user || !user.inviteExpires || user.inviteExpires < new Date()) {
      throw forbidden('This invite link is invalid or has expired');
    }
    const { hashPassword } = await import('../../lib/auth');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        isActive: true,
        inviteToken: null,
        inviteExpires: null,
      },
    });
    res.json({ ok: true });
  })
);
