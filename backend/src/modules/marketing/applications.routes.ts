import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { notFound } from '../../lib/errors';
import { advanceLead } from '../public/public.service';
import { appOrigin } from '../../lib/email';
import { ALLOWED_DOCUMENT_TYPES, sendStoredFile } from '../../lib/upload';
import { defaultZoomLink, OFFICE_ADDRESS } from '../../lib/appointments';
import {
  sendAppointmentConfirmedEmail,
  sendAppointmentDeclinedEmail,
  sendApplicationApprovedEmail,
  sendApplicationRejectedEmail,
} from '../../lib/email.applications';

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
        // Metadata only — the file bytes are streamed on demand, not loaded
        // into every list response.
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, label: true, fileName: true, mimeType: true, size: true, createdAt: true },
        },
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

    // Tell the applicant either way. A decision they are never told about is
    // the same as no decision at all from where they are sitting.
    if (b.status === 'APPROVED' && existing.status !== 'APPROVED') {
      sendApplicationApprovedEmail({
        to: existing.email,
        name: existing.name,
        tier: existing.tier,
        targetArea: existing.targetArea,
        // Only a note written for this moment is passed on; an older internal
        // review note was never meant for their eyes.
        note: b.reviewNote ?? null,
      }).catch((e) => console.error('[applications] approval email failed', e?.message));
    } else if (b.status === 'REJECTED' && existing.status !== 'REJECTED') {
      sendApplicationRejectedEmail({
        to: existing.email,
        name: existing.name,
        tier: existing.tier,
      }).catch((e) => console.error('[applications] rejection email failed', e?.message));
    }
  })
);

// GET /marketing/applications/:id/attachments/:attId — read a file the
// applicant sent back. Cross-referenced against the application so an id from
// one cannot be used to reach another's.
applicationsRouter.get(
  '/:id/attachments/:attId',
  asyncHandler(async (req, res) => {
    const att = await prisma.applicationAttachment.findFirst({
      where: { id: req.params.attId, applicationId: req.params.id },
    });
    if (!att) throw notFound('Attachment not found');
    sendStoredFile(res, att, 'attachment', ALLOWED_DOCUMENT_TYPES);
  })
);

const appointmentActionSchema = z.object({
  action: z.enum(['CONFIRM', 'DECLINE', 'COMPLETE', 'NO_SHOW']),
  // For CONFIRM. Omitted means "the time they asked for is fine".
  confirmedAt: z.coerce.date().optional(),
  zoomLink: z.string().url().max(500).nullable().optional().or(z.literal('')),
  location: z.string().max(300).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  outcome: z.string().max(1000).nullable().optional(),
});

// PATCH /marketing/applications/appointments/:id — confirm a requested meeting,
// decline it, or record how it went. The applicant is told either way; a
// request that is silently ignored is worse than a decline.
applicationsRouter.patch(
  '/appointments/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { application: true },
    });
    if (!existing) throw notFound('Appointment not found');
    const b = appointmentActionSchema.parse(req.body);
    const app = existing.application;

    if (b.action === 'CONFIRM') {
      const confirmedAt = b.confirmedAt ?? existing.requestedAt;
      // A Zoom meeting confirmed without a link falls back to the standing
      // room, so forgetting to paste one never sends an applicant a
      // confirmation with nowhere to join.
      const zoomLink =
        existing.kind === 'ZOOM' ? b.zoomLink || defaultZoomLink() : null;
      const appointment = await prisma.appointment.update({
        where: { id: existing.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt,
          zoomLink,
          location: existing.kind === 'ZOOM' ? null : b.location || OFFICE_ADDRESS,
          note: b.note ?? existing.note,
        },
      });
      await advanceLead(app.leadId, ['interview', 'meeting', 'appointment']);
      res.json(appointment);

      sendAppointmentConfirmedEmail({
        to: app.email,
        name: app.name,
        kind: existing.kind,
        requestedAt: existing.requestedAt,
        confirmedAt,
        zoomLink: appointment.zoomLink,
        location: appointment.location,
        note: appointment.note,
      }).catch((e) => console.error('[appointments] confirm email failed', e?.message));
      return;
    }

    if (b.action === 'DECLINE') {
      const appointment = await prisma.appointment.update({
        where: { id: existing.id },
        data: { status: 'DECLINED', note: b.note ?? existing.note },
      });
      res.json(appointment);

      sendAppointmentDeclinedEmail({
        to: app.email,
        name: app.name,
        requestedAt: existing.requestedAt,
        reason: b.note ?? null,
        statusUrl: `${appOrigin()}/apply/status/${app.token}`,
      }).catch((e) => console.error('[appointments] decline email failed', e?.message));
      return;
    }

    // COMPLETE / NO_SHOW — recording what actually happened.
    const appointment = await prisma.appointment.update({
      where: { id: existing.id },
      data: { status: b.action === 'COMPLETE' ? 'COMPLETED' : 'NO_SHOW', outcome: b.outcome ?? null },
    });
    if (b.action === 'COMPLETE') {
      // A meeting that happened is the step before signing.
      await advanceLead(app.leadId, ['sign', 'closing', 'negotiat']);
    }
    res.json(appointment);
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
