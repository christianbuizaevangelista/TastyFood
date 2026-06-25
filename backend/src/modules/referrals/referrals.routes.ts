import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission, assertInScope } from '../../middleware/rbac';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { notifyRecipients } from '../../lib/notify';
import { sendReferralEmail } from '../../lib/email';

export const referralsRouter = Router();
referralsRouter.use(authenticate);
referralsRouter.use(requirePermission('referrals'));

// GET /referrals — the Principal sees referrals it sent; everyone else sees the
// referrals addressed to their own organization.
referralsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const isPrincipal = req.auth!.role === 'PRINCIPAL';
    const referrals = await prisma.referral.findMany({
      where: isPrincipal ? { fromOrgId: req.auth!.orgId } : { toOrgId: req.auth!.orgId },
      include: {
        toOrg: { select: { id: true, name: true, type: true } },
        fromOrg: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ referrals, mine: isPrincipal ? 'sent' : 'received' });
  })
);

const createSchema = z.object({
  toOrgId: z.string().min(1),
  name: z.string().min(1).max(160),
  address: z.string().min(1).max(400),
  cpNumber: z.string().min(1).max(40),
  note: z.string().max(1000).optional(),
});

// POST /referrals — the Principal refers a lead to a downstream account, which
// is then notified by email. Principal only.
referralsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'PRINCIPAL') throw forbidden('Only the Principal can create referrals');
    const body = createSchema.parse(req.body);
    assertInScope(req, body.toOrgId);
    if (body.toOrgId === req.auth!.orgId) throw badRequest('Choose a downstream account to refer to');
    const toOrg = await prisma.organization.findUnique({ where: { id: body.toOrgId } });
    if (!toOrg || toOrg.archivedAt) throw notFound('Account not found');

    const referral = await prisma.referral.create({
      data: {
        fromOrgId: req.auth!.orgId,
        toOrgId: body.toOrgId,
        name: body.name,
        address: body.address,
        cpNumber: body.cpNumber,
        note: body.note ?? null,
        createdById: req.auth!.sub,
      },
      include: { toOrg: { select: { id: true, name: true, type: true } } },
    });

    // Email the recipient account (owner + active staff with the 'referrals' permission).
    let invite: { sent: boolean; reason?: string } = { sent: false };
    try {
      const recipients = await notifyRecipients(body.toOrgId, 'referrals');
      for (const to of recipients) {
        invite = await sendReferralEmail({
          to,
          toOrgName: toOrg.name,
          leadName: body.name,
          address: body.address,
          cpNumber: body.cpNumber,
          note: body.note,
        });
      }
    } catch (err) {
      console.error('[referral] notification failed', err);
    }

    res.status(201).json({ ...referral, invite });
  })
);
