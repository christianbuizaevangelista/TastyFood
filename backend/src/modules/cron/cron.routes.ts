import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { unauthorized } from '../../lib/errors';
import { sendWebinarReminderEmail, WebinarReminderKind, appOrigin } from '../../lib/email';
import {
  sendOrientationThankYouEmail,
  sendAppointmentMorningEmail,
  sendOwnerDayBriefEmail,
} from '../../lib/email.applications';
import { advanceLead, principalOwnerEmail } from '../public/public.service';

// Scheduled jobs, invoked by Vercel Cron (or any scheduler) rather than by a
// signed-in user. Nothing here reads a session cookie, so every route is gated
// on a shared secret instead.
export const cronRouter = Router();

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when the
// project has CRON_SECRET set. Without the secret configured we refuse rather
// than run wide open — an unauthenticated mail sender is a spam cannon.
function assertCronCaller(req: any): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw unauthorized('CRON_SECRET is not configured');
  const header = req.headers.authorization ?? '';
  if (header !== `Bearer ${secret}`) throw unauthorized('Invalid cron credentials');
}

// The audience is Philippine, and "2 days before" has to mean two calendar days
// in Manila — not 48 hours — or a 7pm session would remind people at 7pm two
// days earlier and drift with the schedule.
function manilaDayNumber(d: Date): number {
  const s = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  return Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
}

const LATE_AFTER_MS = 5 * 60 * 1000;
// Stop chasing a session an hour in; past that the "we've started" nudge is
// just noise.
const LATE_WINDOW_MS = 60 * 60 * 1000;

type Due = { kind: WebinarReminderKind; field: 'remind2dAt' | 'remind1dAt' | 'remindDayAt' | 'remindLateAt' };

// Which reminder, if any, this registration is due for right now.
type SentStamps = { [K in Due['field']]: Date | null };

function dueReminder(startsAt: Date, now: Date, sent: SentStamps, attended: boolean): Due | null {
  const daysOut = manilaDayNumber(startsAt) - manilaDayNumber(now);
  const ms = startsAt.getTime() - now.getTime();

  // Once the session has started, the only thing left to send is the nudge —
  // and only to people not already marked as having joined.
  if (ms <= 0) {
    const since = -ms;
    if (!attended && since >= LATE_AFTER_MS && since <= LATE_WINDOW_MS && !sent.remindLateAt) {
      return { kind: 'STARTED', field: 'remindLateAt' };
    }
    return null;
  }
  if (daysOut === 0 && !sent.remindDayAt) return { kind: 'TODAY', field: 'remindDayAt' };
  if (daysOut === 1 && !sent.remind1dAt) return { kind: 'ONE_DAY', field: 'remind1dAt' };
  if (daysOut === 2 && !sent.remind2dAt) return { kind: 'TWO_DAYS', field: 'remind2dAt' };
  return null;
}

// GET|POST /cron/webinar-reminders — send whatever is due right now.
// Safe to call at any frequency: each reminder is stamped once it is sent, so
// repeat calls in the same window send nothing.
cronRouter.all(
  '/webinar-reminders',
  asyncHandler(async (req, res) => {
    assertCronCaller(req);
    const now = new Date();

    // Only sessions near enough to matter: from two and a half days out to an
    // hour past their start.
    const sessions = await prisma.webinarSession.findMany({
      where: {
        isActive: true,
        scheduledAt: {
          gte: new Date(now.getTime() - LATE_WINDOW_MS),
          lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      },
      include: { webinar: true, registrations: true },
    });

    const results: { kind: string; to: string; sent: boolean; reason?: string }[] = [];

    for (const s of sessions) {
      for (const r of s.registrations) {
        const due = dueReminder(s.scheduledAt, now, r, r.attended);
        if (!due) continue;

        // Stamp BEFORE sending. A duplicate email is worse than a missed one:
        // if the send throws after the mail has actually gone out, a retry
        // would mail the same person again.
        await prisma.webinarRegistration.update({
          where: { id: r.id },
          data: { [due.field]: now },
        });

        const out = await sendWebinarReminderEmail({
          to: r.email,
          name: r.name,
          title: s.webinar.title,
          kind: due.kind,
          scheduledAt: s.scheduledAt,
          zoomLink: s.zoomLink || s.webinar.zoomLink,
          zoomMeetingId: s.zoomMeetingId || s.webinar.zoomMeetingId,
          zoomPasscode: s.zoomPasscode || s.webinar.zoomPasscode,
        });
        results.push({ kind: due.kind, to: r.email, ...out });

        // A send that never left (no API key, Resend down) should be retried on
        // the next run rather than silently swallowed.
        if (!out.sent) {
          await prisma.webinarRegistration.update({
            where: { id: r.id },
            data: { [due.field]: null },
          });
        }
      }
    }

    // ---- The day after: thank the people who actually turned up -----------
    // Only sessions that ran yesterday, and only registrants ticked off as
    // attended. Someone who registered and never showed gets nothing — a
    // thank-you for a meeting they missed reads as a form letter.
    const yesterday = await prisma.webinarSession.findMany({
      where: {
        scheduledAt: {
          gte: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
          lt: now,
        },
      },
      include: { webinar: true, registrations: { where: { attended: true, thankYouAt: null } } },
    });

    for (const s of yesterday) {
      if (manilaDayNumber(now) - manilaDayNumber(s.scheduledAt) !== 1) continue;
      for (const r of s.registrations) {
        await prisma.webinarRegistration.update({
          where: { id: r.id },
          data: { thankYouAt: now },
        });
        const out = await sendOrientationThankYouEmail({
          to: r.email,
          name: r.name,
          title: s.webinar.title,
          // Carrying the registration id lets the application attach itself to
          // the lead they already have, instead of creating a second one.
          applyUrl: `${appOrigin()}/apply?ref=${r.id}`,
        });
        results.push({ kind: 'THANK_YOU', to: r.email, ...out });
        if (!out.sent) {
          await prisma.webinarRegistration.update({ where: { id: r.id }, data: { thankYouAt: null } });
        } else {
          // Attending is real progress worth showing in the funnel.
          await advanceLead(r.leadId, ['attend', 'orientation']);
        }
      }
    }

    // ---- The morning of a confirmed meeting -------------------------------
    // One email to the applicant asking them to confirm they can still make it,
    // and one brief to the owner covering the whole day.
    const todaysMeetings = await prisma.appointment.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: {
          gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 36 * 60 * 60 * 1000),
        },
      },
      include: { application: true },
      orderBy: { confirmedAt: 'asc' },
    });
    const today = todaysMeetings.filter(
      (m) => m.confirmedAt && manilaDayNumber(m.confirmedAt) === manilaDayNumber(now)
    );

    for (const m of today) {
      if (m.remindDayAt) continue;
      await prisma.appointment.update({ where: { id: m.id }, data: { remindDayAt: now } });
      const out = await sendAppointmentMorningEmail({
        to: m.application.email,
        name: m.application.name,
        kind: m.kind,
        confirmedAt: m.confirmedAt!,
        zoomLink: m.zoomLink,
        location: m.location,
      });
      results.push({ kind: 'MEETING_TODAY', to: m.application.email, ...out });
      if (!out.sent) {
        await prisma.appointment.update({ where: { id: m.id }, data: { remindDayAt: null } });
      }
    }

    // The owner's brief goes out once for the whole day, not once per meeting.
    const unbriefed = today.filter((m) => !m.ownerBriefAt);
    if (unbriefed.length) {
      const owner = await principalOwnerEmail();
      if (owner) {
        await prisma.appointment.updateMany({
          where: { id: { in: unbriefed.map((m) => m.id) } },
          data: { ownerBriefAt: now },
        });
        const out = await sendOwnerDayBriefEmail({
          to: owner,
          meetings: today.map((m) => ({
            name: m.application.name,
            tier: m.application.tier,
            kind: m.kind,
            confirmedAt: m.confirmedAt!,
            phone: m.application.phone,
            email: m.application.email,
            area: [m.application.city, m.application.province].filter(Boolean).join(', ') || null,
            zoomLink: m.zoomLink,
          })),
        });
        results.push({ kind: 'DAY_BRIEF', to: owner, ...out });
        if (!out.sent) {
          await prisma.appointment.updateMany({
            where: { id: { in: unbriefed.map((m) => m.id) } },
            data: { ownerBriefAt: null },
          });
        }
      }
    }

    res.json({
      ranAt: now.toISOString(),
      sessionsChecked: sessions.length,
      meetingsToday: today.length,
      sent: results.filter((r) => r.sent).length,
      failed: results.filter((r) => !r.sent).length,
      results,
    });
  })
);
