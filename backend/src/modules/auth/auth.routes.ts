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
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }
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
    });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
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
