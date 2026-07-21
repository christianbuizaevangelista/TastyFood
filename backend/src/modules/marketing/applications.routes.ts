import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound } from '../../lib/errors';
import { advanceLead } from '../public/public.service';

// The Principal's side of the online application: review what came in from the
// public /apply page and move it along. Same gate as the rest of Marketing.
export const applicationsRouter = Router();
applicationsRouter.use(authenticate);
applicationsRouter.use(requireRole('PRINCIPAL'));
applicationsRouter.use(requirePermission('marketing'));

const STATUSES = ['SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED'] as const;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  tier: z.enum(['PROVINCIAL', 'CITY', 'RESELLER', 'RETAIL']).optional(),
  area: z.string().max(120).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

// GET /marketing/applications — the review queue, with the same filters the
// funnel offers so the two read consistently.
applicationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const area = q.area?.trim();

    const applications = await prisma.application.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.tier ? { tier: q.tier } : {}),
        ...(area
          ? {
              OR: [
                { city: { contains: area, mode: 'insensitive' } },
                { province: { contains: area, mode: 'insensitive' } },
                { targetArea: { contains: area, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(q.from || q.to
          ? {
              createdAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                // An inclusive "to" date has to cover the whole day.
                ...(q.to ? { lt: new Date(new Date(q.to).getTime() + 86400000) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        lead: { select: { id: true, funnelId: true, stageIndex: true } },
        appointments: { orderBy: { createdAt: 'desc' } },
      },
    });

    const all = await prisma.application.groupBy({ by: ['status'], _count: true });
    const count = (s: string) => all.find((a) => a.status === s)?._count ?? 0;

    res.json({
      applications,
      summary: {
        total: all.reduce((n, a) => n + a._count, 0),
        submitted: count('SUBMITTED'),
        reviewing: count('REVIEWING'),
        approved: count('APPROVED'),
        rejected: count('REJECTED'),
      },
    });
  })
);

const reviewSchema = z.object({
  status: z.enum(STATUSES),
  reviewNote: z.string().max(1000).nullable().optional(),
});

// PATCH /marketing/applications/:id — move an application through review.
applicationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Application not found');
    const b = reviewSchema.parse(req.body);

    const application = await prisma.application.update({
      where: { id: existing.id },
      data: {
        status: b.status,
        reviewNote: b.reviewNote ?? existing.reviewNote,
        reviewedAt: new Date(),
      },
    });

    // Keep the funnel honest: an approval is a win, a rejection is a loss, and
    // anything in between just moves the lead along.
    if (existing.leadId) {
      if (b.status === 'APPROVED') {
        await prisma.lead
          .update({
            where: { id: existing.leadId },
            data: { status: 'WON', closedAt: new Date() },
          })
          .catch(() => undefined);
      } else if (b.status === 'REJECTED') {
        await prisma.lead
          .update({
            where: { id: existing.leadId },
            data: { status: 'LOST', closedAt: new Date(), lostReason: b.reviewNote ?? 'Application rejected' },
          })
          .catch(() => undefined);
      } else if (b.status === 'REVIEWING') {
        await advanceLead(existing.leadId, ['review', 'qualif', 'interview']);
      }
    }

    res.json(application);
  })
);

// DELETE /marketing/applications/:id — remove spam or a duplicate. The public
// form is open to anyone, so junk happens.
applicationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Application not found');
    await prisma.application.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);
