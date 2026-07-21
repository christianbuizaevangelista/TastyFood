import { BRAND_GREEN, appOrigin, emailShell } from './email';

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
  return `<p style="text-align:center;margin:22px 0">
     <a href="${href}" style="${style};text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:bold;display:inline-block">${text}</a>
   </p>
   <p style="color:#999;font-size:12px;word-break:break-all">Or paste this into your browser: ${href}</p>`;
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
  formTitle?: string | null;
}): Promise<SendResult> {
  const origin = appOrigin();
  const statusUrl = `${origin}/apply/status/${p.token}`;
  const formUrl = `${origin}/api/public/apply/${p.token}/form`;
  const tier = TIER_LABEL[p.tier] ?? p.tier;

  const formBlock = p.formTitle
    ? `<p>Here is the official application form for a <strong>${tier}</strong>. Please fill it in
         and bring it to your meeting with us — or email it back before then.</p>
       ${button(formUrl, `Download the ${tier} form`)}`
    : `<p>We will email you the official <strong>${tier}</strong> application form shortly.</p>`;

  const html = emailShell(
    'Distributorship Application',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">We have your application</h2>
     <p>Hi ${p.name}, thank you for applying to become a <strong>${tier}</strong> with Tasty Food.
     We have everything we need to start reviewing it.</p>
     ${formBlock}
     <p><strong>What happens next.</strong> We check whether your area is still open, then invite you
     to a short meeting — over Zoom, or at our office in General Trias, whichever suits you. You can
     ask for a schedule and follow your application here:</p>
     ${button(statusUrl, 'Request a meeting', false)}
     <p style="color:#888;font-size:13px">Keep this email — that link is how you check your
     application without needing an account.</p>`
  );
  return send(p.to, `Your ${tier} application — Tasty Food`, html, 'application receipt');
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
