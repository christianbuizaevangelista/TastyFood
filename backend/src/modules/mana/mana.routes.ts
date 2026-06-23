import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { badRequest, notFound, forbidden, conflict } from '../../lib/errors';
import { adjustMana } from './mana.service';
import { sendManaPurchaseEmail } from '../../lib/email';

export const manaRouter = Router();
manaRouter.use(authenticate);
manaRouter.use(requirePermission('mana'));

const MAX_PROOF = 3 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];

// GET /mana/wallet — current balance + recent transactions for the requester's org.
manaRouter.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.auth!.orgId },
      select: { manaBalance: true },
    });
    const transactions = await prisma.manaTxn.findMany({
      where: { orgId: req.auth!.orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ balance: org?.manaBalance ?? 0, transactions });
  })
);

// GET /mana/purchases — own requests; Principal sees all (to approve).
manaRouter.get(
  '/purchases',
  asyncHandler(async (req, res) => {
    const where =
      req.auth!.role === 'PRINCIPAL'
        ? req.query.status
          ? { status: req.query.status as any }
          : {}
        : { orgId: req.auth!.orgId };
    const purchases = await prisma.manaPurchase.findMany({
      where,
      select: {
        id: true,
        amount: true,
        status: true,
        fileName: true,
        size: true,
        createdAt: true,
        org: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ purchases });
  })
);

// POST /mana/purchases — request to buy Mana with proof of payment.
const buySchema = z.object({
  amount: z.number().positive(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});
manaRouter.post(
  '/purchases',
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== 'PROVINCIAL' && req.auth!.role !== 'CITY') {
      throw forbidden('Only Provincial and City distributors can buy Mana');
    }
    const body = buySchema.parse(req.body);
    if (!ALLOWED.includes(body.mimeType.toLowerCase())) {
      throw badRequest('Proof must be an image (PNG/JPG/WEBP) or PDF');
    }
    const cleaned = body.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const size = Math.floor((cleaned.length * 3) / 4);
    if (size > MAX_PROOF) throw badRequest('Proof file too large (max 3 MB)');

    const purchase = await prisma.manaPurchase.create({
      data: {
        orgId: req.auth!.orgId,
        amount: body.amount,
        fileName: body.fileName,
        mimeType: body.mimeType,
        size,
        data: cleaned,
        requestedById: req.auth!.sub,
      },
      select: { id: true, amount: true, status: true },
    });

    // Notify the Principal so they can review and approve (best-effort).
    try {
      const principal = await prisma.organization.findFirst({
        where: { type: 'PRINCIPAL' },
        include: { users: { take: 1, orderBy: { createdAt: 'asc' }, select: { email: true } } },
      });
      const buyer = await prisma.organization.findUnique({ where: { id: req.auth!.orgId }, select: { name: true } });
      const to = principal?.contactEmail || principal?.users[0]?.email || '';
      await sendManaPurchaseEmail({ to, orgName: buyer?.name ?? 'A distributor', amount: body.amount });
    } catch (err) {
      console.error('[mana.buy] notification failed', err);
    }

    res.status(201).json(purchase);
  })
);

// GET /mana/purchases/:id/proof — view proof (owner or Principal).
manaRouter.get(
  '/purchases/:id/proof',
  asyncHandler(async (req, res) => {
    const p = await prisma.manaPurchase.findUnique({ where: { id: req.params.id } });
    if (!p) throw notFound('Request not found');
    if (req.auth!.role !== 'PRINCIPAL' && p.orgId !== req.auth!.orgId) throw forbidden();
    res.setHeader('Content-Type', p.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${p.fileName}"`);
    res.send(Buffer.from(p.data, 'base64'));
  })
);

// POST /mana/purchases/:id/decide — Principal approves/rejects; approval credits Mana.
const decideSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().optional() });
manaRouter.post(
  '/purchases/:id/decide',
  requireRole('PRINCIPAL'),
  asyncHandler(async (req, res) => {
    const body = decideSchema.parse(req.body);
    const p = await prisma.manaPurchase.findUnique({ where: { id: req.params.id } });
    if (!p) throw notFound('Request not found');
    if (p.status !== 'PENDING') throw conflict('Request already decided');

    await prisma.$transaction(async (tx) => {
      await tx.manaPurchase.update({
        where: { id: p.id },
        data: { status: body.status, note: body.note, decidedById: req.auth!.sub, decidedAt: new Date() },
      });
      if (body.status === 'APPROVED') {
        await adjustMana(tx, {
          orgId: p.orgId,
          change: p.amount,
          reason: 'MANA_PURCHASE',
          refType: 'ManaPurchase',
          refId: p.id,
        });
      }
    });
    res.json({ ok: true });
  })
);
