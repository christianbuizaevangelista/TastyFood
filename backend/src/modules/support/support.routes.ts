import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { forbidden, notFound } from '../../lib/errors';
import { notifyRecipients } from '../../lib/notify';
import { sendSupportTicketEmail, sendSupportReplyEmail } from '../../lib/email';

// Distributors raise concerns with the Principal here.
//
// The sender's name, position, contact number and email are NEVER accepted from
// the request body — they are read from the session and the account record. A
// disabled input in the browser is only a hint; deriving them server-side is
// what actually makes them unchangeable.
export const supportRouter = Router();
supportRouter.use(authenticate);

const ROLE_LABEL: Record<string, string> = {
  PRINCIPAL: 'Principal',
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
};

// "Provincial Distributor · Owner" — the tier plus whether they run the account
// or are staff under it.
function positionOf(role: string, isOwner: boolean): string {
  return `${ROLE_LABEL[role] ?? role} · ${isOwner ? 'Owner' : 'Staff'}`;
}

// The identity the form shows, and the identity a submission is stamped with.
async function senderIdentity(auth: { sub: string; orgId: string; role: string; isOwner: boolean }) {
  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { name: true, email: true, isOwner: true, role: true, org: { select: { name: true, contactPhone: true } } },
  });
  if (!user) throw notFound('Account not found');
  return {
    senderName: user.name,
    position: positionOf(user.role, user.isOwner),
    // Distributors have no personal phone on file; the account's registered
    // contact number is the number the Principal would call back.
    phone: user.org.contactPhone ?? null,
    email: user.email,
    orgName: user.org.name,
  };
}

// GET /support/me — the identity to display, plus this account's own history.
supportRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const identity = await senderIdentity(req.auth!);
    const tickets = await prisma.supportTicket.findMany({
      where: { orgId: req.auth!.orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ identity, tickets });
  })
);

// POST /support — raise a concern. Only the message comes from the sender.
supportRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (req.auth!.role === 'PRINCIPAL') throw forbidden('The Principal receives concerns rather than raising them');
    const { message } = z.object({ message: z.string().min(1).max(4000) }).parse(req.body);
    const identity = await senderIdentity(req.auth!);

    const ticket = await prisma.supportTicket.create({
      data: {
        orgId: req.auth!.orgId,
        createdById: req.auth!.sub,
        senderName: identity.senderName,
        position: identity.position,
        phone: identity.phone,
        email: identity.email,
        message: message.trim(),
      },
    });
    res.status(201).json(ticket);

    // Tell the Principal there's something waiting. Best-effort.
    (async () => {
      const principal = await prisma.organization.findFirst({ where: { type: 'PRINCIPAL' }, select: { id: true } });
      if (!principal) return;
      for (const to of await notifyRecipients(principal.id, 'support')) {
        await sendSupportTicketEmail({
          to,
          senderName: identity.senderName,
          orgName: identity.orgName,
          position: identity.position,
          phone: identity.phone,
          email: identity.email,
          message: ticket.message,
        });
      }
    })().catch((e) => console.error('[support] notification failed', e?.message));
  })
);

// GET /support — the Principal's inbox.
supportRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'PRINCIPAL') throw forbidden('Only the Principal can view all concerns');
    const status = req.query.status as string | undefined;
    const tickets = await prisma.supportTicket.findMany({
      where: status === 'OPEN' || status === 'RESOLVED' ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { org: { select: { id: true, name: true, type: true } } },
    });
    const open = tickets.filter((t) => t.status === 'OPEN').length;
    res.json({ tickets, summary: { total: tickets.length, open, resolved: tickets.length - open } });
  })
);

// PATCH /support/:id — the Principal replies and/or closes a concern.
supportRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'PRINCIPAL') throw forbidden('Only the Principal can respond to concerns');
    const body = z
      .object({ reply: z.string().max(4000).nullable().optional(), status: z.enum(['OPEN', 'RESOLVED']).optional() })
      .parse(req.body);
    const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Concern not found');

    const ticket = await prisma.supportTicket.update({
      where: { id: existing.id },
      data: {
        reply: body.reply !== undefined ? body.reply || null : existing.reply,
        status: body.status ?? existing.status,
        repliedAt: body.reply ? new Date() : existing.repliedAt,
      },
    });
    res.json(ticket);

    // Let the sender know a reply landed. Best-effort.
    if (body.reply && body.reply.trim() && body.reply !== existing.reply) {
      (async () => {
        for (const to of await notifyRecipients(ticket.orgId, 'support')) {
          await sendSupportReplyEmail({ to, senderName: ticket.senderName, message: ticket.message, reply: ticket.reply! });
        }
      })().catch((e) => console.error('[support] reply notification failed', e?.message));
    }
  })
);
