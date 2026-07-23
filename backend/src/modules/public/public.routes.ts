import { Router, Request } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { sendWebinarConfirmationEmail } from '../../lib/email';
import { resolveFunnel } from './public.service';

// Public, UNAUTHENTICATED endpoints backing the recruitment landing page at
// /join. Everything here is reachable by anyone on the internet, so each route
// is deliberately narrow: read-only webinar copy, and one write that can only
// ever create a webinar sign-up.
export const publicRouter = Router();

const INTERESTS = ['PROVINCIAL', 'CITY', 'RESELLER', 'RETAIL', 'UNSURE'] as const;

// Rate limiting for the public form. Hashed so we never store a raw IP.
const MAX_PER_IP_PER_HOUR = 5;
function hashIp(req: Request): string | null {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.socket.remoteAddress || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// A slot stays offered for a short while after it starts so nobody loses their
// pick to the clock while they are filling the form in.
const GRACE_MS = 30 * 60 * 1000;
function openSessionFilter() {
  return { isActive: true, scheduledAt: { gte: new Date(Date.now() - GRACE_MS) } };
}

// GET /public/webinar — the live webinar's public details and the schedules on
// offer. Deliberately omits every Zoom link: those are only returned after
// registering, and only for the slot the person actually picked.
publicRouter.get(
  '/webinar',
  asyncHandler(async (_req, res) => {
    const w = await prisma.webinar.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        headline: true,
        description: true,
        scheduledAt: true,
        sessions: {
          where: openSessionFilter(),
          orderBy: { scheduledAt: 'asc' },
          select: { id: true, scheduledAt: true },
        },
      },
    });
    if (!w) return res.json({ webinar: null });
    res.json({ webinar: w });
  })
);

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  phone: z.string().min(5).max(40),
  city: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
  interest: z.enum(INTERESTS).default('UNSURE'),
  // Which of the offered schedules they picked.
  sessionId: z.string().optional(),
  message: z.string().max(1000).optional(),
  // Honeypot: a field hidden from real users. Bots fill every input they find,
  // so anything here means automated submission.
  website: z.string().max(200).optional(),
});

// POST /public/webinar/register — sign up for the orientation.
publicRouter.post(
  '/webinar/register',
  asyncHandler(async (req, res) => {
    const b = registerSchema.parse(req.body);

    // Honeypot tripped — answer as if it worked so bots get no signal, but
    // store nothing.
    if (b.website && b.website.trim().length > 0) {
      return res.status(201).json({ ok: true, zoom: null });
    }

    const webinar = await prisma.webinar.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!webinar) throw notFound('There is no orientation open for registration right now');

    // Resolve the chosen schedule. When slots are on offer one MUST be picked —
    // otherwise we would be emailing joining details for a time nobody agreed to.
    const open = await prisma.webinarSession.findMany({
      where: { webinarId: webinar.id, ...openSessionFilter() },
      orderBy: { scheduledAt: 'asc' },
    });
    let session: (typeof open)[number] | null = null;
    if (open.length) {
      session = open.find((s) => s.id === b.sessionId) ?? null;
      if (!session) throw badRequest('Please choose one of the available schedules');
    }

    const ipHash = hashIp(req);
    if (ipHash) {
      const recent = await prisma.webinarRegistration.count({
        where: { ipHash, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (recent >= MAX_PER_IP_PER_HOUR) {
        throw badRequest('Too many registrations from this connection. Please try again later.');
      }
    }

    const email = b.email.toLowerCase().trim();
    const existing = await prisma.webinarRegistration.findUnique({
      where: { webinarId_email: { webinarId: webinar.id, email } },
    });

    const fields = {
      name: b.name.trim(),
      phone: b.phone.trim(),
      city: b.city?.trim() || null,
      province: b.province?.trim() || null,
      interest: b.interest,
      sessionId: session?.id ?? null,
      message: b.message?.trim() || null,
      ipHash,
    };

    let registration;
    if (existing) {
      // Same person signing up again — refresh their details, don't duplicate.
      registration = await prisma.webinarRegistration.update({ where: { id: existing.id }, data: fields });
    } else {
      registration = await prisma.webinarRegistration.create({
        data: { webinarId: webinar.id, email, ...fields },
      });

      // Push the sign-up into a funnel as a new lead so it can be worked like
      // any other. Best-effort: a funnel problem must never cost us the
      // registration itself.
      {
        try {
          const funnel = await resolveFunnel(webinar.funnelId, webinar.createdById);
          if (funnel) {
            const lead = await prisma.lead.create({
              data: {
                funnelId: funnel.id,
                name: fields.name,
                phone: fields.phone,
                email,
                address: [fields.city, fields.province].filter(Boolean).join(', ') || null,
                // Kept separately as well, so the funnel can be filtered by area
                // and by the tier they are after without parsing the note.
                city: fields.city,
                province: fields.province,
                interest: b.interest,
                source: 'WEBSITE',
                stageIndex: 0,
                note: `Registered for "${webinar.title}"${
                  session ? ` — ${session.scheduledAt.toISOString()}` : ''
                }. Interested in: ${b.interest}.${
                  fields.message ? ` Message: ${fields.message}` : ''
                }`,
                createdById: webinar.createdById,
              },
            });
            await prisma.webinarRegistration.update({
              where: { id: registration.id },
              data: { leadId: lead.id },
            });
          }
        } catch (err: any) {
          console.error('[public.register] lead creation failed', err?.message);
        }
      }
    }

    // A slot can carry its own meeting, or share the webinar's recurring one.
    const zoom = {
      link: session?.zoomLink || webinar.zoomLink,
      meetingId: session?.zoomMeetingId || webinar.zoomMeetingId,
      passcode: session?.zoomPasscode || webinar.zoomPasscode,
      scheduledAt: session?.scheduledAt ?? webinar.scheduledAt,
      title: webinar.title,
    };

    // Email the joining details BEFORE responding. On serverless the container
    // can freeze the moment the response is flushed, dropping any fetch started
    // after res.json() — which would leave the sign-up without their Zoom link.
    // Best-effort: a mail failure must never fail the registration.
    await sendWebinarConfirmationEmail({
      to: email,
      name: fields.name,
      title: webinar.title,
      scheduledAt: zoom.scheduledAt,
      zoomLink: zoom.link,
      zoomMeetingId: zoom.meetingId,
      zoomPasscode: zoom.passcode,
    }).catch((e) => console.error('[public.register] confirmation email failed', e?.message));

    res.status(201).json({ ok: true, zoom });
  })
);
