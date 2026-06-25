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
  // The handwritten signature image is served by the web app (frontend/public).
  const origin = (process.env.CLIENT_ORIGIN || 'https://tasty-food-manufacturing-inc.vercel.app').replace(/\/$/, '');
  const sigUrl = `${origin}/signature.png`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#333;line-height:1.55">
      <div style="background:#0b9444;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <strong style="font-size:17px">Tasty Food Manufacturing Inc.</strong>
        <div style="font-size:11px;opacity:.9">Distribution Management System</div>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:22px;border-radius:0 0 8px 8px">
        <p style="margin:0 0 12px"><strong>Good day${p.name ? ', ' + p.name : ''}!</strong></p>
        <p>On behalf of our entire team, we would like to extend a heartfelt welcome to you as a valued member of our growing network of <strong>Distributors and Resellers</strong>.</p>
        <p>We are truly delighted to have you on board. Your partnership marks an important step toward our shared growth, and we are committed to supporting you at every stage of your journey with our brand.</p>
        <p style="margin-bottom:6px">Here is some key information as we begin our partnership:</p>
        <ul style="margin:0 0 12px;padding-left:18px">
          <li style="margin-bottom:4px"><strong>Dedicated Support</strong> — A dedicated team is ready to assist you with inquiries, orders, and consultations.</li>
          <li style="margin-bottom:4px"><strong>Product Resources</strong> — We will provide you with a complete product catalog, pricing, and marketing materials.</li>
          <li><strong>Onboarding</strong> — We will schedule a brief orientation to ensure a smooth start.</li>
        </ul>
        <p>To get started, please set your account password:</p>
        <p style="text-align:center;margin:20px 0">
          <a href="${p.link}" style="background:#0b9444;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold;display:inline-block">Set your password</a>
        </p>
        <p style="color:#999;font-size:12px;margin-bottom:18px">Or paste this link into your browser: ${p.link}</p>
        <p>Should you have any questions, please do not hesitate to reach out. We are here to ensure your partnership with us is a success.</p>
        <p>Once again, welcome aboard. We look forward to a successful and long-lasting relationship.</p>
        <p style="margin:18px 0 0">Regards,</p>
        <img src="${sigUrl}" alt="Christian Evangelista" width="280" style="display:block;height:auto;max-width:280px;margin:4px 0 -24px" />
        <div style="font-weight:bold;color:#222">Christian Evangelista</div>
        <div style="color:#555;font-size:13px">President and CEO</div>
        <div style="color:#555;font-size:13px">Tasty Food Manufacturing Inc.</div>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: 'Welcome to Tasty Food Manufacturing Inc. 🎉', html }),
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

// Notify a distributor/reseller that the Principal referred a new lead to them.
export async function sendReferralEmail(p: {
  to: string;
  toOrgName: string;
  leadName: string;
  address: string;
  cpNumber: string;
  note?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — referral for ${p.to}: ${p.leadName}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const noteRow = p.note
    ? `<tr><td style="padding:6px 0;color:#888;vertical-align:top">Note</td><td style="padding:6px 0">${p.note}</td></tr>`
    : '';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#333;line-height:1.55">
      <div style="background:#0b9444;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <strong style="font-size:16px">Tasty Food Manufacturing Inc.</strong>
        <div style="font-size:11px;opacity:.9">New Referral</div>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:22px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">📨 You have a new referral</h2>
        <p>Hi ${p.toOrgName}, Tasty Food has referred a new lead/customer to you. Please reach out to them:</p>
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#888;width:120px">Name</td><td style="padding:6px 0;font-weight:bold">${p.leadName}</td></tr>
          <tr><td style="padding:6px 0;color:#888;vertical-align:top">Address</td><td style="padding:6px 0">${p.address}</td></tr>
          <tr><td style="padding:6px 0;color:#888">CP Number</td><td style="padding:6px 0">${p.cpNumber}</td></tr>
          ${noteRow}
        </table>
        <p style="margin-top:12px;color:#666">You can also see this in the Referrals page of your dashboard.</p>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `New referral: ${p.leadName}`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] referral send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

// Internal staff (Users & Roles) invite — simpler than the distributor welcome.
export async function sendStaffInviteEmail(p: {
  to: string;
  name: string;
  orgName: string;
  link: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — staff invite for ${p.to}: ${p.link}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#333;line-height:1.55">
      <div style="background:#0b9444;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <strong style="font-size:17px">${p.orgName}</strong>
        <div style="font-size:11px;opacity:.9">Distribution Management System</div>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:22px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">You've been added to the team 👋</h2>
        <p>Hi ${p.name}, you have been given staff access to the <strong>${p.orgName}</strong> Distribution Management System.</p>
        <p>Set your password to sign in:</p>
        <p style="text-align:center;margin:20px 0">
          <a href="${p.link}" style="background:#0b9444;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:bold;display:inline-block">Set your password</a>
        </p>
        <p style="color:#999;font-size:12px">Or paste this link into your browser: ${p.link}</p>
        <p style="color:#999;font-size:12px">This link expires in 7 days.</p>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `Your ${p.orgName} staff access`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] staff invite send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

// Notify the buyer when their purchase order changes status (approved / rejected / fulfilled).
const PO_STATUS: Record<string, { label: string; emoji: string; msg: string }> = {
  APPROVED: { label: 'Approved', emoji: '✅', msg: 'has been approved by your supplier and is being prepared.' },
  CANCELLED: { label: 'Rejected', emoji: '❌', msg: 'was rejected by your supplier. Please contact them for details.' },
  FULFILLED: { label: 'Fulfilled', emoji: '📦', msg: 'has been fulfilled and is on its way. You can mark it received in the app.' },
};
export async function sendPoStatusEmail(p: {
  to: string;
  poNumber: string;
  buyerName: string;
  sellerName: string;
  status: string;
  total: number;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  const s = PO_STATUS[p.status];
  if (!s) return { sent: false, reason: `no email for status ${p.status}` };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — PO ${p.poNumber} ${p.status} for ${p.to}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#333;line-height:1.55">
      <div style="background:#0b9444;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <strong style="font-size:16px">Tasty Food Manufacturing Inc.</strong>
        <div style="font-size:11px;opacity:.9">Purchase Order Update</div>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:22px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">${s.emoji} Purchase order ${s.label}</h2>
        <p>Hi ${p.buyerName}, your purchase order <strong>${p.poNumber}</strong> (${peso(p.total)}) ${s.msg}</p>
        <p style="color:#888;font-size:13px">Supplier: ${p.sellerName}</p>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `PO ${p.poNumber} — ${s.label}`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] PO status send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

// Notify the buyer that their Mana purchase was approved and credited.
export async function sendManaApprovedEmail(p: {
  to: string;
  orgName: string;
  amount: number;
  newBalance?: number;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — Mana approved for ${p.to}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const balanceLine =
    typeof p.newBalance === 'number'
      ? `<p style="color:#888;font-size:13px">New Mana balance: <strong>${peso(p.newBalance)}</strong> (${p.newBalance.toLocaleString()} ✨)</p>`
      : '';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#333;line-height:1.55">
      <div style="background:#0b9444;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <strong style="font-size:16px">Tasty Food Manufacturing Inc.</strong>
        <div style="font-size:11px;opacity:.9">Mana Wallet</div>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:22px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">✨ Mana purchase approved</h2>
        <p>Hi ${p.orgName}, your purchase of <strong>${peso(p.amount)}</strong> worth of Mana
        (${p.amount.toLocaleString()} ✨) has been approved and credited to your wallet.</p>
        ${balanceLine}
        <p>You can now use it to pay for purchase orders.</p>
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `Your Mana purchase was approved ✨`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] mana approved send failed', err?.message);
    return { sent: false, reason: err?.message ?? 'send failed' };
  }
}

export async function sendStockRequestEmail(p: {
  to: string;
  poNumber: string;
  items: { name: string; sku: string; quantity: number }[];
  note?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tasty Food <onboarding@resend.dev>';
  if (!p.to) return { sent: false, reason: 'no recipient email' };
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — stock request ${p.poNumber} for ${p.to}`);
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }
  const rows = p.items
    .map((i) => `<tr><td style="padding:4px 8px">${i.name}</td><td style="padding:4px 8px;color:#888">${i.sku}</td><td style="padding:4px 8px;text-align:right;font-weight:bold">${i.quantity}</td></tr>`)
    .join('');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#0b9444;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
        <strong style="font-size:16px">Tasty Food Manufacturing Inc.</strong>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:18px;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px">Production Stock Request — ${p.poNumber}</h2>
        <p>Please produce / prepare the following quantities:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="background:#f4f4f4"><th style="padding:6px 8px;text-align:left">Product</th><th style="padding:6px 8px;text-align:left">SKU</th><th style="padding:6px 8px;text-align:right">Qty</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${p.note ? `<p style="margin-top:12px"><b>Note:</b> ${p.note}</p>` : ''}
      </div>
    </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [p.to], subject: `Stock Request ${p.poNumber}`, html }),
    });
    if (!res.ok) {
      console.error('[email] Resend error', res.status, await res.text());
      return { sent: false, reason: `Resend responded ${res.status}` };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[email] stock request send failed', err?.message);
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
