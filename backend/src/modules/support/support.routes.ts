import { Router, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { sendSupportTicketEmail, sendSupportReplyEmail } from '../../lib/email';
import { assertAllowedUploadType, sendStoredFile } from '../../lib/upload';

// A private line from a distributor to the Principal owner.
//
// Two rules hold this together:
//  1. The sender's identity is read from the session and the account record,
//     never from the request body, so it cannot be altered.
//  2. Only the Principal OWNER can read concerns. Not Principal staff, and
//     never another distributor — the whole point is that a reseller can raise
//     something without the rest of the network learning about it. A sender
//     sees only what they themselves submitted.
export const supportRouter = Router();
supportRouter.use(authenticate);

const MAX_ATTACHMENTS = 10;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB per file

const ROLE_LABEL: Record<string, string> = {
  PRINCIPAL: 'Principal',
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
};

function positionOf(role: string, isOwner: boolean): string {
  return `${ROLE_LABEL[role] ?? role} · ${isOwner ? 'Owner' : 'Staff'}`;
}

// Only the Principal's owner may read or answer concerns.
function requirePrincipalOwner(req: Request) {
  if (req.auth!.role !== 'PRINCIPAL' || !req.auth!.isOwner) {
    throw forbidden('Only the Principal owner can access concerns');
  }
}

async function senderIdentity(auth: { sub: string }) {
  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { name: true, email: true, isOwner: true, role: true, org: { select: { name: true, contactPhone: true } } },
  });
  if (!user) throw notFound('Account not found');
  return {
    senderName: user.name,
    position: positionOf(user.role, user.isOwner),
    // Users have no personal phone on file, so this is the account's registered
    // contact number — the number the Principal would call back.
    phone: user.org.contactPhone ?? null,
    email: user.email,
    orgName: user.org.name,
  };
}

// The Principal owner's own address — concerns go here and nowhere else.
async function principalOwnerEmail(): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { role: 'PRINCIPAL', isOwner: true, isActive: true },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
  });
  return owner?.email ?? null;
}

const attachmentSelect = { id: true, fileName: true, mimeType: true, size: true, createdAt: true };

// GET /support/me — the identity shown on the form, plus this user's own history.
supportRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const identity = await senderIdentity(req.auth!);
    const tickets = await prisma.supportTicket.findMany({
      // Scoped to the individual, not the account: a colleague on the same
      // login domain shouldn't read what someone else raised.
      where: { createdById: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { attachments: { select: attachmentSelect } },
    });
    res.json({ identity, tickets, maxAttachments: MAX_ATTACHMENTS });
  })
);

// POST /support — raise a concern. Only the message is taken from the sender.
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
  })
);

// POST /support/:id/notify — sent once the sender's attachments are in, so the
// Principal's email mentions the right number of files.
supportRouter.post(
  '/:id/notify',
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { attachments: true } } },
    });
    if (!ticket) throw notFound('Concern not found');
    if (ticket.createdById !== req.auth!.sub) throw forbidden('Not your concern');

    const to = await principalOwnerEmail();
    res.json({ ok: true });
    if (!to) return;

    const org = await prisma.organization.findUnique({ where: { id: ticket.orgId }, select: { name: true } });
    sendSupportTicketEmail({
      to,
      senderName: ticket.senderName,
      orgName: org?.name ?? '',
      position: ticket.position,
      phone: ticket.phone,
      email: ticket.email,
      message: ticket.message,
      attachmentCount: ticket._count.attachments,
    }).catch((e) => console.error('[support] notification failed', e?.message));
  })
);

// GET /support — the Principal owner's inbox.
supportRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    requirePrincipalOwner(req);
    const status = req.query.status as string | undefined;
    const tickets = await prisma.supportTicket.findMany({
      where: status === 'OPEN' || status === 'RESOLVED' ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        org: { select: { id: true, name: true, type: true } },
        attachments: { select: attachmentSelect },
      },
    });
    const open = tickets.filter((t) => t.status === 'OPEN').length;
    res.json({ tickets, summary: { total: tickets.length, open, resolved: tickets.length - open } });
  })
);

// PATCH /support/:id — the Principal owner replies and/or closes a concern.
supportRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    requirePrincipalOwner(req);
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

    // Answer goes back to the person who raised it, nobody else.
    if (body.reply && body.reply.trim() && body.reply !== existing.reply) {
      sendSupportReplyEmail({
        to: ticket.email,
        senderName: ticket.senderName,
        message: ticket.message,
        reply: ticket.reply!,
      }).catch((e) => console.error('[support] reply notification failed', e?.message));
    }
  })
);

// Readable by the person who raised it, or the Principal owner. Nobody else —
// not even another user in the sender's own account.
async function loadVisibleTicket(req: Request, id: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw notFound('Concern not found');
  const isAuthor = ticket.createdById === req.auth!.sub;
  const isPrincipalOwner = req.auth!.role === 'PRINCIPAL' && req.auth!.isOwner;
  if (!isAuthor && !isPrincipalOwner) throw forbidden('You cannot access this concern');
  return ticket;
}

const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});

// POST /support/:id/attachments — one file per request, so a batch of ten never
// runs into the JSON body limit.
supportRouter.post(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const ticket = await loadVisibleTicket(req, req.params.id);
    if (ticket.createdById !== req.auth!.sub) throw forbidden('Only the sender can attach files');

    const count = await prisma.supportAttachment.count({ where: { ticketId: ticket.id } });
    if (count >= MAX_ATTACHMENTS) throw badRequest(`You can attach up to ${MAX_ATTACHMENTS} files`);

    const body = uploadSchema.parse(req.body);
    assertAllowedUploadType(body.mimeType);
    const data = body.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const size = Math.floor((data.length * 3) / 4);
    if (size > MAX_UPLOAD_BYTES) throw badRequest(`"${body.fileName}" is too large (max 3 MB)`);

    const att = await prisma.supportAttachment.create({
      data: { ticketId: ticket.id, fileName: body.fileName, mimeType: body.mimeType, size, data },
      select: attachmentSelect,
    });
    res.status(201).json(att);
  })
);

// GET /support/:id/attachments/:attId — stream a file.
supportRouter.get(
  '/:id/attachments/:attId',
  asyncHandler(async (req, res) => {
    const ticket = await loadVisibleTicket(req, req.params.id);
    const att = await prisma.supportAttachment.findFirst({
      where: { id: req.params.attId, ticketId: ticket.id },
    });
    if (!att) throw notFound('Attachment not found');
    sendStoredFile(res, att);
  })
);
