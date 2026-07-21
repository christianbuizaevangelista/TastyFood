import { Router, Request } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { sendStoredFile } from '../../lib/upload';
import {
  sendApplicationReceivedEmail,
  sendApplicationOwnerAlert,
  sendAppointmentRequestedAlert,
} from '../../lib/email.applications';
import { resolveFunnel, advanceLead, principalOwnerEmail } from './public.service';

// Public, UNAUTHENTICATED endpoints for the online distributorship application
// at /apply. Usually reached from the thank-you email after an orientation,
// but the page stands on its own so an ad can point straight at it.
export const applyRouter = Router();

const TIERS = ['PROVINCIAL', 'CITY', 'RESELLER', 'RETAIL'] as const;

const MAX_PER_IP_PER_HOUR = 5;
function hashIp(req: Request): string | null {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.socket.remoteAddress || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// GET /public/apply/config — what the public application page needs to render.
applyRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    // Which tiers actually have an official form on file. Every tier is still
    // offered; this only decides whether we promise them a form to download.
    const forms = await prisma.material.findMany({
      where: { applicationTier: { not: null } },
      select: { applicationTier: true },
    });
    res.json({
      tiers: TIERS,
      formsAvailable: forms.map((f) => f.applicationTier).filter(Boolean),
    });
  })
);

const applySchema = z.object({
  tier: z.enum(TIERS),
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  phone: z.string().min(5).max(40),
  address: z.string().max(300).optional(),
  barangay: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
  businessName: z.string().max(160).optional(),
  hasStore: z.boolean().default(false),
  experience: z.string().max(1000).optional(),
  capital: z.number().min(0).max(100000000).optional(),
  targetArea: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
  // The orientation sign-up this came from, when they followed the emailed link.
  ref: z.string().optional(),
  // Honeypot: hidden from real users, filled by bots.
  website: z.string().max(200).optional(),
});

// POST /public/apply — submit an application.
applyRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = applySchema.parse(req.body);
    // Answer as if it worked so bots get no signal, but store nothing.
    if (b.website && b.website.trim().length > 0) {
      return res.status(201).json({ ok: true, token: null });
    }

    const ipHash = hashIp(req);
    if (ipHash) {
      const recent = await prisma.application.count({
        where: { ipHash, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (recent >= MAX_PER_IP_PER_HOUR) {
        throw badRequest('Too many applications from this connection. Please try again later.');
      }
    }

    const email = b.email.toLowerCase().trim();
    const city = b.city?.trim() || null;
    const province = b.province?.trim() || null;

    // Tie the application to a funnel lead: the one from their orientation
    // sign-up if we can find it, else a matching open lead by email, else a
    // fresh one. An applicant must never be invisible in the funnel.
    let leadId: string | null = null;
    let registrationId: string | null = null;
    if (b.ref) {
      const reg = await prisma.webinarRegistration.findUnique({ where: { id: b.ref } });
      if (reg) {
        registrationId = reg.id;
        leadId = reg.leadId;
      }
    }
    if (!leadId) {
      const existing = await prisma.lead.findFirst({
        where: { email, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
      });
      leadId = existing?.id ?? null;
    }
    if (!leadId) {
      const webinar = await prisma.webinar.findFirst({ orderBy: { createdAt: 'desc' } });
      const funnel = await resolveFunnel(webinar?.funnelId ?? null, webinar?.createdById ?? null);
      if (funnel) {
        const lead = await prisma.lead.create({
          data: {
            funnelId: funnel.id,
            name: b.name.trim(),
            phone: b.phone.trim(),
            email,
            address: [city, province].filter(Boolean).join(', ') || null,
            city,
            province,
            interest: b.tier,
            source: 'WEBSITE',
            stageIndex: 0,
            note: `Applied online for ${b.tier}.`,
            createdById: funnel.createdById,
          },
        });
        leadId = lead.id;
      }
    }

    const application = await prisma.application.create({
      data: {
        token: crypto.randomBytes(24).toString('base64url'),
        tier: b.tier,
        name: b.name.trim(),
        email,
        phone: b.phone.trim(),
        address: b.address?.trim() || null,
        barangay: b.barangay?.trim() || null,
        city,
        province,
        businessName: b.businessName?.trim() || null,
        hasStore: b.hasStore,
        experience: b.experience?.trim() || null,
        capital: b.capital ?? null,
        targetArea: b.targetArea?.trim() || null,
        note: b.note?.trim() || null,
        leadId,
        registrationId,
        ipHash,
      },
    });

    // Applying is a real step forward, and it settles what tier they are after.
    await advanceLead(leadId, ['application', 'applied', 'apply']);
    if (leadId) {
      await prisma.lead
        .update({
          where: { id: leadId },
          data: { interest: b.tier, ...(city ? { city } : {}), ...(province ? { province } : {}) },
        })
        .catch(() => undefined);
    }

    const form = await prisma.material.findFirst({ where: { applicationTier: b.tier } });
    res.status(201).json({ ok: true, token: application.token, formAvailable: !!form });

    // Confirmation to the applicant, and a heads-up to the Principal. Both are
    // best-effort: an email problem must never cost us the application.
    sendApplicationReceivedEmail({
      to: email,
      name: application.name,
      tier: b.tier,
      token: application.token,
      formTitle: form?.title ?? null,
    }).catch((e) => console.error('[apply] applicant email failed', e?.message));

    principalOwnerEmail()
      .then((owner) =>
        owner
          ? sendApplicationOwnerAlert({
              to: owner,
              name: application.name,
              tier: b.tier,
              email,
              phone: application.phone,
              area: [city, province].filter(Boolean).join(', ') || null,
              capital: application.capital,
              note: application.note,
            })
          : null
      )
      .catch((e) => console.error('[apply] owner alert failed', e?.message));
  })
);

// GET /public/apply/:token — an applicant checking their own status.
applyRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const a = await prisma.application.findUnique({
      where: { token: req.params.token },
      include: { appointments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!a) throw notFound('Application not found');
    const form = await prisma.material.findFirst({ where: { applicationTier: a.tier } });
    res.json({
      name: a.name,
      tier: a.tier,
      status: a.status,
      submittedAt: a.createdAt,
      formAvailable: !!form,
      appointments: a.appointments.map((p) => ({
        kind: p.kind,
        status: p.status,
        requestedAt: p.requestedAt,
        confirmedAt: p.confirmedAt,
        // Joining details only exist once the meeting is actually confirmed.
        zoomLink: p.status === 'CONFIRMED' ? p.zoomLink : null,
        location: p.status === 'CONFIRMED' ? p.location : null,
        note: p.note,
      })),
    });
  })
);

const appointmentSchema = z.object({
  kind: z.enum(['ZOOM', 'OFFICE_VISIT']),
  requestedAt: z.coerce.date(),
  altRequestedAt: z.coerce.date().nullable().optional(),
  note: z.string().max(500).optional(),
});

// POST /public/apply/:token/appointment — the applicant asks for a meeting.
// They propose; the Principal confirms in the app. Nothing here is binding.
applyRouter.post(
  '/:token/appointment',
  asyncHandler(async (req, res) => {
    const a = await prisma.application.findUnique({
      where: { token: req.params.token },
      include: { appointments: true },
    });
    if (!a) throw notFound('Application not found');
    const b = appointmentSchema.parse(req.body);

    if (b.requestedAt.getTime() < Date.now()) {
      throw badRequest('Please pick a date and time in the future');
    }
    // One live request at a time, or the queue fills with duplicates.
    if (a.appointments.some((p) => p.status === 'REQUESTED')) {
      throw badRequest('You already have a meeting request waiting for confirmation');
    }

    const appointment = await prisma.appointment.create({
      data: {
        applicationId: a.id,
        kind: b.kind,
        requestedAt: b.requestedAt,
        altRequestedAt: b.altRequestedAt ?? null,
        note: b.note?.trim() || null,
      },
    });

    await advanceLead(a.leadId, ['interview', 'meeting', 'appointment']);
    res.status(201).json({ ok: true, status: appointment.status });

    principalOwnerEmail()
      .then((owner) =>
        owner
          ? sendAppointmentRequestedAlert({
              to: owner,
              name: a.name,
              tier: a.tier,
              phone: a.phone,
              email: a.email,
              kind: b.kind,
              requestedAt: b.requestedAt,
              altRequestedAt: b.altRequestedAt ?? null,
              note: b.note ?? null,
            })
          : null
      )
      .catch((e) => console.error('[apply] appointment alert failed', e?.message));
  })
);

// GET /public/apply/:token/form — download the official form for their tier.
applyRouter.get(
  '/:token/form',
  asyncHandler(async (req, res) => {
    const a = await prisma.application.findUnique({ where: { token: req.params.token } });
    if (!a) throw notFound('Application not found');
    const form = await prisma.material.findFirst({
      where: { applicationTier: a.tier },
      orderBy: { createdAt: 'desc' },
    });
    if (!form) throw notFound('No application form has been uploaded for this level yet');
    sendStoredFile(res, form, 'attachment');
  })
);
