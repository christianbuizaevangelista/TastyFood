// Lightweight email sender using the Resend HTTP API (no SMTP ports, which
// suits serverless). If RESEND_API_KEY is not set, it logs and no-ops so the
// app keeps working without email configured.

const DIST_LABEL: Record<string, string> = { TRADE: 'Regular', DROP_SHIP: 'Dropship' };

function peso(n: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n || 0);
}

interface ReceiptLine {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}
interface SaleReceipt {
  number: string;
  seller: { name: string };
  customerName?: string;
  discountRate: number;
  subtotal: number;
  total: number;
  savings: number;
  createdAt: string | Date;
  lines: ReceiptLine[];
}

export async function sendSaleReceiptEmail(p: {
  to: string;
  receipt: SaleReceipt;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — would email receipt ${p.receipt.number} to ${p.to}`);
    return { sent: false, reason: 'Email is not configured (RESEND_API_KEY missing)' };
  }

  const r = p.receipt;
  const rows = r.lines
    .map(
      (l) => `<tr>
        <td style="padding:4px 0">${l.name}<br><span style="color:#999;font-size:11px">${l.quantity} × ${peso(l.unitPrice)}</span></td>
        <td style="padding:4px 0;text-align:right">${peso(l.lineTotal)}</td>
      </tr>`
    )
    .join('');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
      <div style="text-align:center;padding:12px">
        <strong style="color:#e8521d;font-size:18px">Juan Palaman</strong><br>
        <span style="color:#888;font-size:12px">${r.seller.name}</span>
      </div>
      <div style="border:1px solid #eee;border-radius:8px;padding:16px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#888">
          <span>${r.number}</span><span>${new Date(r.createdAt).toLocaleString('en-PH')}</span>
        </div>
        <p style="font-size:12px;color:#666">Customer: ${r.customerName ?? 'Walk-in'}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
        <hr style="border:none;border-top:1px dashed #ddd">
        <table style="width:100%;font-size:13px">
          <tr><td style="color:#888">Subtotal (SRP)</td><td style="text-align:right">${peso(r.subtotal)}</td></tr>
          <tr><td style="color:#888">Discount (${Math.round(r.discountRate * 100)}%)</td><td style="text-align:right">- ${peso(r.savings)}</td></tr>
          <tr><td style="font-weight:bold;color:#e8521d">Total</td><td style="text-align:right;font-weight:bold;color:#e8521d">${peso(r.total)}</td></tr>
        </table>
      </div>
      <p style="text-align:center;color:#aaa;font-size:11px;margin-top:8px">Thank you for your purchase!</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `Receipt ${r.number} — Juan Palaman`, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[email] Resend error', res.status, body);
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] receipt send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

export async function sendManaPurchaseEmail(p: {
  to: string;
  orgName: string;
  amount: number;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — would notify ${p.to} of Mana purchase by ${p.orgName}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
      <div style="background:#e8521d;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
        <strong style="font-size:16px">Juan Palaman · Tasty Food Mfg. Inc.</strong>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:18px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">New Mana purchase request ✨</h2>
        <p><strong>${p.orgName}</strong> wants to buy <strong>${peso(p.amount)}</strong> worth of Mana
        (${p.amount.toLocaleString()} ✨).</p>
        <p>Review the attached proof of payment and approve it in the Mana Wallet page.</p>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `Mana purchase request from ${p.orgName}`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] mana purchase send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

export async function sendLowStockEmail(p: {
  to: string;
  orgName: string;
  items: { name: string; sku: string; quantity: number; reorderLevel: number }[];
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — low-stock reminder for ${p.orgName}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const rows = p.items
    .map(
      (i) => `<tr>
        <td style="padding:4px 8px">${i.name}<br><span style="color:#999;font-size:11px">${i.sku}</span></td>
        <td style="padding:4px 8px;text-align:right;color:#c0392b;font-weight:bold">${i.quantity}</td>
        <td style="padding:4px 8px;text-align:right;color:#888">${i.reorderLevel}</td>
      </tr>`
    )
    .join('');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
      <div style="background:#e8521d;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
        <strong style="font-size:16px">Juan Palaman · Tasty Food Mfg. Inc.</strong>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:18px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 6px">⚠️ Low stock reminder</h2>
        <p>${p.orgName}, the following item(s) have reached their critical stock level:</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr style="color:#888;text-align:left"><th style="padding:4px 8px">Item</th><th style="padding:4px 8px;text-align:right">On hand</th><th style="padding:4px 8px;text-align:right">Reorder @</th></tr>
          ${rows}
        </table>
        <p style="margin-top:12px;color:#666">Please reorder soon to avoid running out.</p>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `Low stock reminder — ${p.items.length} item(s)`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] low-stock send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

export async function sendInviteEmail(p: {
  to: string;
  name: string;
  orgName: string;
  link: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — invite for ${p.to}: ${p.link}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
      <div style="background:#e8521d;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
        <strong style="font-size:16px">Juan Palaman · Tasty Food Mfg. Inc.</strong>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:18px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">You've been invited 🎉</h2>
        <p>Hi ${p.name}, ${p.orgName} has created an account for you on the distribution portal.</p>
        <p>Click below to set your password and get started:</p>
        <p style="text-align:center;margin:18px 0">
          <a href="${p.link}" style="background:#e8521d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Set your password</a>
        </p>
        <p style="color:#888;font-size:12px">Or paste this link: ${p.link}</p>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `You're invited to ${p.orgName}`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] invite send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

export interface PoSubmittedEmail {
  to: string;
  supplierName: string;
  poNumber: string;
  buyerName: string;
  total: number;
  distributionType: string;
  itemsCount: number;
}

export async function sendPoSubmittedEmail(p: PoSubmittedEmail): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';

  if (!p.to) return { sent: false, reason: 'supplier has no email on file' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — would notify ${p.to} of PO ${p.poNumber}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }

  const dist = DIST_LABEL[p.distributionType] ?? p.distributionType;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#e8521d;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <strong style="font-size:18px">Juan Palaman · Tasty Food Mfg. Inc.</strong>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">New Purchase Order to approve</h2>
        <p>Hi ${p.supplierName}, you have received a new purchase order awaiting your approval.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#666">PO Number</td><td style="text-align:right"><strong>${p.poNumber}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#666">From</td><td style="text-align:right">${p.buyerName}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Distribution</td><td style="text-align:right">${dist}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Items</td><td style="text-align:right">${p.itemsCount}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Total</td><td style="text-align:right"><strong>${peso(p.total)}</strong></td></tr>
        </table>
        <p style="margin-top:16px">Log in to the distribution portal to review and approve this order.</p>
      </div>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [p.to],
        subject: `New Purchase Order ${p.poNumber} from ${p.buyerName}`,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[email] Resend error', res.status, body);
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}
