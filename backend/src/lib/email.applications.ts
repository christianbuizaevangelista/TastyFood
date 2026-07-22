import { BRAND_GREEN, appOrigin, emailShell } from './email';
import { OFFICE_ADDRESS, OFFICE_MAPS_URL, slotLabel } from './appointments';

// Emails for the recruitment pipeline that follows an orientation: the
// day-after thank-you, the application receipt, and the alert to the owner.
// They live apart from email.ts only because that file is already long.

type SendResult = { sent: boolean; reason?: string };

const TIER_LABEL: Record<string, string> = {
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
  RETAIL: 'Retail Distributor',
};

// One place for the Resend call, so every sender here fails the same way and a
// missing key is a no-op rather than a crash.
async function send(to: string, subject: string, html: string, label: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — ${label} for ${to}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error(`[email] ${label} send failed`, err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

function button(href: string, text: string, filled = true): string {
  const style = filled
    ? `background:${BRAND_GREEN};color:#fff;border:2px solid ${BRAND_GREEN}`
    : `background:#fff;color:${BRAND_GREEN};border:2px solid ${BRAND_GREEN}`;
  // No raw-URL fallback underneath: these go to people who are not distributors
  // yet, so a bare link only adds clutter they cannot act on.
  return `<p style="text-align:center;margin:22px 0">
     <a href="${href}" style="${style};text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:bold;display:inline-block">${text}</a>
   </p>`;
}

// The day after an orientation, thank the people who actually showed up and
// point them at the application. Interest is highest right now, and a vague
// "let us know" wastes it — so this asks for one specific next step.
export async function sendOrientationThankYouEmail(p: {
  to: string;
  name: string;
  title: string;
  applyUrl: string;
}): Promise<SendResult> {
  const html = emailShell(
    'Distributor Orientation',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">Thank you for joining us</h2>
     <p>Hi ${p.name}, thank you for attending <strong>${p.title}</strong> yesterday. We hope it
     gave you a clear picture of how the business works and what your own territory could look like.</p>
     <p><strong>Still interested?</strong> The next step is a short application — about five
     minutes — and it tells us which areas are still open for you.</p>
     ${button(p.applyUrl, 'Apply to become a distributor')}
     <p style="color:#888;font-size:13px">Not ready yet, or still weighing it up? Just reply to this
     email with your questions — a real person reads every one.</p>`
  );
  return send(p.to, `Thank you for joining ${p.title}`, html, 'orientation thank-you');
}

// Confirms an online application, hands over the official form for the tier
// they picked, and points them at where to ask for a meeting.
export async function sendApplicationReceivedEmail(p: {
  to: string;
  name: string;
  tier: string;
  token: string;
  code?: string | null;
  formTitle?: string | null;
}): Promise<SendResult> {
  const origin = appOrigin();
  const statusUrl = `${origin}/apply/status/${p.token}`;
  const formUrl = `${origin}/api/public/apply/${p.token}/form`;
  const tier = TIER_LABEL[p.tier] ?? p.tier;

  const formBlock = p.formTitle
    ? `<p>Here is the official application form for a <strong>${tier}</strong>. Fill it in, then send
         it back through the link below — a clear photo or scan is fine.</p>
       ${button(formUrl, `Download the ${tier} form`)}`
    : `<p>We will email you the official <strong>${tier}</strong> application form shortly.</p>`;

  const html = emailShell(
    'Distributorship Application',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">We have your application</h2>
     <p>Hi ${p.name}, thank you for applying to become a <strong>${tier}</strong> with Tasty Food.
     We have everything we need to start reviewing it.</p>
     ${
       p.code
         ? `<p style="text-align:center;margin:18px 0">
              <span style="display:inline-block;border:2px dashed ${BRAND_GREEN};border-radius:10px;padding:12px 22px">
                <span style="display:block;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#888">Your tracking code</span>
                <span style="display:block;font-size:22px;font-weight:bold;letter-spacing:2px;color:${BRAND_GREEN}">${p.code}</span>
              </span>
            </p>
            <p style="text-align:center;color:#888;font-size:12px">Keep this — you can check your
            progress any time at <strong>${appOrigin()}/track</strong> with this code and your
            email address.</p>`
         : ''
     }
     ${formBlock}
     <p><strong>What happens next.</strong> Send us the filled-in form, and we will check whether your
     area is still open and invite you to a short meeting — over Zoom, or at our office in General
     Trias, whichever suits you. Everything happens on one page:</p>
     ${button(statusUrl, 'Send my form and request a meeting', false)}
     <p style="color:#888;font-size:13px">Keep this email — that link is how you check your
     application without needing an account.</p>`
  );
  return send(p.to, `Your ${tier} application — Tasty Food`, html, 'application receipt');
}

// The applicant has sent their filled-in form back. This is the point where an
// application stops being an enquiry and becomes a decision waiting on you.
export async function sendApplicationFormReceivedAlert(p: {
  to: string;
  name: string;
  tier: string;
  email: string;
  phone: string;
  fileName: string;
}): Promise<SendResult> {
  const tier = TIER_LABEL[p.tier] ?? p.tier;
  const html = emailShell(
    'Form Received',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">${p.name} sent their application form</h2>
     <p><strong>${p.name}</strong> has returned the filled-in <strong>${tier}</strong> form
     (<em>${p.fileName}</em>). The application is now waiting for your review.</p>
     <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
       <tr><td style="padding:5px 14px 5px 0;color:#888">Mobile</td><td style="padding:5px 0"><a href="tel:${p.phone}" style="color:${BRAND_GREEN}">${p.phone}</a></td></tr>
       <tr><td style="padding:5px 14px 5px 0;color:#888">Email</td><td style="padding:5px 0"><a href="mailto:${p.email}" style="color:${BRAND_GREEN}">${p.email}</a></td></tr>
     </table>
     <p style="color:#888;font-size:13px">Open <strong>Marketing &rsaquo; Applications</strong> to read
     the file and approve or decline.</p>`
  );
  return send(p.to, `Form received: ${p.name} (${tier})`, html, 'form received');
}

const KIND_LABEL: Record<string, string> = {
  ZOOM: 'Zoom call',
  OFFICE_VISIT: 'Visit to the office',
};

export function manilaWhen(d: Date | string): string {
  return new Date(d).toLocaleString('en-PH', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  });
}

// Tells the owner an applicant has asked for a meeting, so it can be confirmed
// or moved without digging through the app.
export async function sendAppointmentRequestedAlert(p: {
  to: string;
  name: string;
  tier: string;
  phone: string;
  email: string;
  kind: string;
  requestedAt: Date;
  altRequestedAt?: Date | null;
  note?: string | null;
}): Promise<SendResult> {
  const tier = TIER_LABEL[p.tier] ?? p.tier;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:5px 14px 5px 0;color:#888;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:5px 0">${value}</td></tr>`;

  const rows = [
    row('Applicant', `<strong>${p.name}</strong> — ${tier}`),
    row('Meeting', KIND_LABEL[p.kind] ?? p.kind),
    row('Asked for', `<strong>${manilaWhen(p.requestedAt)}</strong>`),
    p.altRequestedAt ? row('Or', manilaWhen(p.altRequestedAt)) : '',
    row('Mobile', `<a href="tel:${p.phone}" style="color:${BRAND_GREEN}">${p.phone}</a>`),
    row('Email', `<a href="mailto:${p.email}" style="color:${BRAND_GREEN}">${p.email}</a>`),
    p.note ? row('Note', p.note) : '',
  ].join('');

  const html = emailShell(
    'Meeting Request',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">${p.name} is asking for a meeting</h2>
     <table style="border-collapse:collapse;margin:12px 0;font-size:14px">${rows}</table>
     <p style="color:#888;font-size:13px">Open <strong>Marketing &rsaquo; Applications</strong> to
     confirm the time, propose another, or decline. They are told either way.</p>`
  );
  return send(p.to, `Meeting request: ${p.name} (${tier})`, html, 'appointment request');
}

// Confirms a meeting to the applicant. When the time we settled on differs from
// what they asked for, say so plainly at the top — burying a changed time in the
// body is how people turn up on the wrong day.
export async function sendAppointmentConfirmedEmail(p: {
  to: string;
  name: string;
  kind: string;
  requestedAt: Date;
  confirmedAt: Date;
  zoomLink?: string | null;
  location?: string | null;
  note?: string | null;
}): Promise<SendResult> {
  const moved = new Date(p.requestedAt).getTime() !== new Date(p.confirmedAt).getTime();
  const isZoom = p.kind === 'ZOOM';

  const details = [
    `<tr><td style="padding:5px 14px 5px 0;color:#888;white-space:nowrap">When</td><td style="padding:5px 0"><strong>${manilaWhen(
      p.confirmedAt
    )}</strong>${slotLabel(p.confirmedAt) ? `<br><span style="color:#888;font-size:13px">${slotLabel(p.confirmedAt)}</span>` : ''}</td></tr>`,
    `<tr><td style="padding:5px 14px 5px 0;color:#888;white-space:nowrap">Where</td><td style="padding:5px 0">${
      isZoom ? 'Over Zoom' : p.location || OFFICE_ADDRESS
    }</td></tr>`,
    p.note ? `<tr><td style="padding:5px 14px 5px 0;color:#888;vertical-align:top">Note</td><td style="padding:5px 0">${p.note}</td></tr>` : '',
  ].join('');

  const html = emailShell(
    'Meeting Confirmed',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">Your meeting is confirmed</h2>
     <p>Hi ${p.name}, we are looking forward to speaking with you.</p>
     ${
       moved
         ? `<p style="background:#fff6e5;border-left:4px solid #c9821a;padding:10px 14px;margin:14px 0">
              <strong>Please note the time has changed.</strong> You asked for
              ${manilaWhen(p.requestedAt)}; we have set it for
              <strong>${manilaWhen(p.confirmedAt)}</strong>. Reply if that does not work.
            </p>`
         : ''
     }
     <table style="border-collapse:collapse;margin:12px 0;font-size:14px">${details}</table>
     ${
       isZoom && p.zoomLink
         ? button(p.zoomLink, 'Join the Zoom meeting')
         : isZoom
         ? '<p style="color:#666">We will send the Zoom link before the meeting.</p>'
         : `${button(OFFICE_MAPS_URL, '📍 Open the location in Google Maps')}
            <p style="color:#666">Please bring a valid ID and your filled-in application form.</p>`
     }
     <p style="color:#888;font-size:13px">Something came up? Reply to this email and we will move it.</p>`
  );
  return send(p.to, `Confirmed: your Tasty Food meeting — ${manilaWhen(p.confirmedAt)}`, html, 'appointment confirmed');
}

// Tells the applicant we cannot take the meeting. Kept short and without false
// hope, but leaves the door open.
export async function sendAppointmentDeclinedEmail(p: {
  to: string;
  name: string;
  requestedAt: Date;
  reason?: string | null;
  statusUrl: string;
}): Promise<SendResult> {
  const html = emailShell(
    'Meeting Request',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">We cannot make that time</h2>
     <p>Hi ${p.name}, thank you for asking to meet on ${manilaWhen(p.requestedAt)} — unfortunately
     we are not able to take that slot.</p>
     ${p.reason ? `<p>${p.reason}</p>` : ''}
     <p>Please pick another time that suits you and we will confirm it:</p>
     ${button(p.statusUrl, 'Choose another time', false)}`
  );
  return send(p.to, 'About your requested meeting — Tasty Food', html, 'appointment declined');
}

// The morning of the meeting, to the applicant. Its job is to stop a no-show,
// so it asks for a one-word reply rather than assuming they will turn up.
export async function sendAppointmentMorningEmail(p: {
  to: string;
  name: string;
  kind: string;
  confirmedAt: Date;
  zoomLink?: string | null;
  location?: string | null;
  confirmUrl: string;
}): Promise<SendResult> {
  const isZoom = p.kind === 'ZOOM';
  const time = new Date(p.confirmedAt).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
  const window = slotLabel(p.confirmedAt);

  const html = emailShell(
    'Today',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">We are meeting today at ${time}</h2>
     <p>Good morning ${p.name}. Your meeting with Tasty Food is today,
     <strong>${window ?? time}</strong>, ${isZoom ? 'over Zoom' : 'at our office'}.</p>

     ${
       isZoom
         ? p.zoomLink
           ? button(p.zoomLink, 'Join the Zoom meeting')
           : ''
         : `<table style="border-collapse:collapse;margin:14px 0;font-size:14px">
              <tr><td style="padding:5px 14px 5px 0;color:#888;vertical-align:top;white-space:nowrap">Where</td>
                  <td style="padding:5px 0">${p.location || OFFICE_ADDRESS}</td></tr>
            </table>
            ${button(OFFICE_MAPS_URL, '📍 Open the location in Google Maps')}`
     }

     <p style="background:#eef7f1;border-left:4px solid ${BRAND_GREEN};padding:12px 14px;margin:18px 0">
       <strong>Are you still coming today?</strong> Please tap one of the buttons below so we know
       whether to expect you. Either answer is fine — we would much rather know than wait.
     </p>
     ${button(p.confirmUrl, 'Answer: am I coming today?')}

     ${
       !isZoom
         ? '<p style="color:#888;font-size:13px">Please bring a valid ID and your filled-in application form.</p>'
         : ''
     }`
  );
  return send(p.to, `Today at ${time}: please confirm your Tasty Food meeting`, html, 'appointment morning');
}

// The applicant has answered the morning-of check. Whichever way they answered,
// this is the thing that decides whether the Principal drives to the office.
export async function sendAppointmentAnswerAlert(p: {
  to: string;
  name: string;
  tier: string;
  phone: string;
  email: string;
  kind: string;
  confirmedAt: Date;
  answer: 'YES' | 'NO';
  note?: string | null;
}): Promise<SendResult> {
  const tier = TIER_LABEL[p.tier] ?? p.tier;
  const yes = p.answer === 'YES';
  const time = new Date(p.confirmedAt).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
  const tone = yes ? BRAND_GREEN : '#c0392b';

  const html = emailShell(
    'Meeting Confirmation',
    `<h2 style="margin:0 0 8px;color:${tone};font-size:18px">
       ${p.name} ${yes ? 'is coming today' : 'cannot make it today'}
     </h2>
     <p style="background:${yes ? '#eef7f1' : '#fdecea'};border-left:4px solid ${tone};padding:12px 14px;margin:14px 0">
       <strong>${yes ? 'CONFIRMED' : 'CANNOT ATTEND'}</strong> — ${tier} meeting today at
       <strong>${time}</strong>, ${p.kind === 'ZOOM' ? 'over Zoom' : 'at the office'}.
     </p>
     ${p.note ? `<p><strong>They added:</strong> ${p.note}</p>` : ''}
     <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
       <tr><td style="padding:5px 14px 5px 0;color:#888">Mobile</td><td style="padding:5px 0"><a href="tel:${p.phone}" style="color:${BRAND_GREEN}">${p.phone}</a></td></tr>
       <tr><td style="padding:5px 14px 5px 0;color:#888">Email</td><td style="padding:5px 0"><a href="mailto:${p.email}" style="color:${BRAND_GREEN}">${p.email}</a></td></tr>
     </table>
     ${
       yes
         ? ''
         : `<p style="color:#888;font-size:13px">They can pick another time from their tracker,
            or reply to their email to arrange one.</p>`
     }`
  );
  return send(
    p.to,
    `${yes ? 'Confirmed' : 'Cannot attend'}: ${p.name} — today at ${time}`,
    html,
    'appointment answer'
  );
}

// The owner's morning brief: everything happening today, in one email, so the
// day can be planned from the phone.
export async function sendOwnerDayBriefEmail(p: {
  to: string;
  meetings: {
    name: string;
    tier: string;
    kind: string;
    confirmedAt: Date;
    phone: string;
    email: string;
    area?: string | null;
    zoomLink?: string | null;
  }[];
}): Promise<SendResult> {
  const rows = p.meetings
    .map((m) => {
      const time = new Date(m.confirmedAt).toLocaleTimeString('en-PH', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Manila',
      });
      const where = m.kind === 'ZOOM' ? 'Zoom' : 'Office visit';
      return `<tr>
        <td style="padding:9px 14px 9px 0;vertical-align:top;white-space:nowrap"><strong>${time}</strong><br>
          <span style="color:#888;font-size:12px">${where}</span></td>
        <td style="padding:9px 0;vertical-align:top">
          <strong>${m.name}</strong> — ${TIER_LABEL[m.tier] ?? m.tier}<br>
          <span style="font-size:13px;color:#666">${m.area ? m.area + ' &middot; ' : ''}
            <a href="tel:${m.phone}" style="color:${BRAND_GREEN}">${m.phone}</a></span>
          ${m.kind === 'ZOOM' && m.zoomLink ? `<br><a href="${m.zoomLink}" style="color:${BRAND_GREEN};font-size:13px">Join link</a>` : ''}
        </td>
      </tr>`;
    })
    .join('');

  const count = p.meetings.length;
  const html = emailShell(
    'Your Day',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">${count} meeting${
      count === 1 ? '' : 's'
    } today</h2>
     <p>Good morning. Here is what is booked for today — everyone below has been reminded and asked
     to confirm.</p>
     <table style="border-collapse:collapse;margin:14px 0;font-size:14px;width:100%">${rows}</table>
     <p style="color:#888;font-size:13px">After each one, record the outcome in
     <strong>Marketing &rsaquo; Applications</strong> and the lead moves with it.</p>`
  );
  return send(p.to, `Today: ${count} meeting${count === 1 ? '' : 's'}`, html, 'owner day brief');
}

// Tells the owner a new application has landed, with enough detail to judge it
// without opening the app.
export async function sendApplicationOwnerAlert(p: {
  to: string;
  name: string;
  tier: string;
  email: string;
  phone: string;
  area?: string | null;
  capital?: number | null;
  note?: string | null;
}): Promise<SendResult> {
  const tier = TIER_LABEL[p.tier] ?? p.tier;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:5px 14px 5px 0;color:#888;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:5px 0">${value}</td></tr>`;

  const rows = [
    row('Applying for', `<strong>${tier}</strong>`),
    row('Name', p.name),
    row('Mobile', `<a href="tel:${p.phone}" style="color:${BRAND_GREEN}">${p.phone}</a>`),
    row('Email', `<a href="mailto:${p.email}" style="color:${BRAND_GREEN}">${p.email}</a>`),
    p.area ? row('Area', p.area) : '',
    p.capital ? row('Capital ready', `PHP ${p.capital.toLocaleString('en-PH')}`) : '',
    p.note ? row('Note', p.note) : '',
  ].join('');

  const html = emailShell(
    'New Application',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">New distributorship application</h2>
     <p>Someone has applied through your landing page.</p>
     <table style="border-collapse:collapse;margin:12px 0;font-size:14px">${rows}</table>
     <p style="color:#888;font-size:13px">Open <strong>Marketing &rsaquo; Applications</strong> to
     review it. The lead has already moved forward in your funnel.</p>`
  );
  return send(p.to, `New ${tier} application: ${p.name}`, html, 'owner alert');
}
