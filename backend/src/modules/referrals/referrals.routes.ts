import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { notifyRecipients } from '../../lib/notify';
import { sendReferralEmail } from '../../lib/email';
import { getAncestorOrgIds, getDescendantOrgIds } from '../../lib/scope';

export const referralsRouter = Router();
referralsRouter.use(authenticate);
referralsRouter.use(requirePermission('referrals'));

// Resellers can only receive referrals; everyone above can also send them.
const CAN_REFER = ['PRINCIPAL', 'PROVINCIAL', 'CITY'];

// The accounts a user may refer TO: within their province (their downstream)
// plus their upline up to the Principal. Excludes self and deleted accounts.
async function allowedRecipientIds(orgId: string): Promise<string[]> {
  const [down, up] = await Promise.all([getDescendantOrgIds(orgId), getAncestorOrgIds(orgId)]);
  const ids = new Set<string>([...down, ...up]);
  ids.delete(orgId);
  const active = await prisma.organization.findMany({
    where: { id: { in: [...ids] }, archivedAt: null },
    select: { id: true },
  });
  return active.map((o) => o.id);
}

// GET /referrals/recipients — accounts the current user may refer a lead to.
referralsRouter.get(
  '/recipients',
  asyncHandler(async (req, res) => {
    if (!CAN_REFER.includes(req.auth!.role)) return res.json({ recipients: [] });
    const ids = await allowedRecipientIds(req.auth!.orgId);
    const recipients = await prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, contactName: true, type: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json({ recipients });
  })
);

// GET /referrals — referrals the user sent OR received, newest first.
referralsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const myOrgId = req.auth!.orgId;
    const rows = await prisma.referral.findMany({
      where: { OR: [{ fromOrgId: myOrgId }, { toOrgId: myOrgId }] },
      include: {
        toOrg: { select: { id: true, name: true, type: true } },
        fromOrg: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const referrals = rows.map((r) => ({ ...r, direction: r.fromOrgId === myOrgId ? 'sent' : 'received' }));
    res.json({ referrals, canRefer: CAN_REFER.includes(req.auth!.role) });
  })
);

const createSchema = z.object({
  toOrgId: z.string().min(1),
  name: z.string().min(1).max(160),
  address: z.string().min(1).max(400),
  cpNumber: z.string().min(1).max(40),
  note: z.string().max(1000).optional(),
});

// POST /referrals — refer a lead to an account within your province (or your
// upline up to the Principal). The recipient is notified by email.
referralsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!CAN_REFER.includes(req.auth!.role)) throw forbidden('Your role cannot create referrals');
    const body = createSchema.parse(req.body);
    if (body.toOrgId === req.auth!.orgId) throw badRequest('Choose another account to refer to');
    const allowed = await allowedRecipientIds(req.auth!.orgId);
    if (!allowed.includes(body.toOrgId)) throw forbidden('That account is outside the accounts you can refer to');
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
