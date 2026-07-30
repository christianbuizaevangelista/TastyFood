import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { signToken, verifyPassword } from '../../lib/auth';
import { setAuthCookie, clearAuthCookie } from '../../lib/cookie';
import { unauthorized, forbidden } from '../../lib/errors';
import { authenticate } from '../../middleware/auth';

export const authRouter = Router();

// Brute-force lockout: lock an account for LOCKOUT_MS after this many
// consecutive failed logins. bcrypt already makes each guess slow; this caps
// the number of guesses per window regardless of how the requests are spread.
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

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
      include: { org: { include: { territory: { select: { name: true, level: true } } } } },
    });
    if (!user) throw unauthorized('Invalid email or password');
    if (!user.passwordHash) throw forbidden('Please set your password using your invite link first');

    // Brute-force lockout: after too many consecutive failures, temporarily
    // refuse logins for this account regardless of whether the password is right.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw forbidden(`Too many failed attempts. Try again in about ${mins} minute(s).`);
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      // Count the failure; lock the account once the threshold is crossed.
      const attempts = user.failedLoginAttempts + 1;
      const locked = attempts >= MAX_FAILED_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: locked ? 0 : attempts,
          lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
        },
      });
      throw unauthorized('Invalid email or password');
    }
    // Successful password — clear any failure counter.
    if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
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

    // Session lives in an httpOnly cookie (unreadable by page JS). The token is
    // still returned for backward compatibility with any Bearer-based client.
    setAuthCookie(res, token);

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
          territory: user.org.territory,
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
      include: { org: { include: { territory: { select: { name: true, level: true } } } } },
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
        territory: user.org.territory,
      },
    });
  })
);

// POST /auth/logout — clear the session cookie.
authRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
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
    const { token, password, acceptedTerms } = z
      .object({
        token: z.string().min(1),
        password: z.string().min(6),
        // The Terms & Conditions must be accepted before an account can be
        // activated. Enforced here too — never trust the checkbox alone.
        acceptedTerms: z.literal(true, {
          errorMap: () => ({ message: 'You must accept the Terms & Conditions to continue' }),
        }),
      })
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
        termsAcceptedAt: new Date(),
      },
    });
    res.json({ ok: true });
  })
);
