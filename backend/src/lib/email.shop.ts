import { BRAND_GREEN, appOrigin, emailShell } from './email';

// Emails for the public JuanPalaman shop. Kept apart from the recruitment
// emails because the audience is different — these go to retail buyers, not
// prospective distributors.

type SendResult = { sent: boolean; reason?: string };

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

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAY_LABEL: Record<string, string> = {
  CASH_ON_DELIVERY: 'Cash on delivery',
  PAY_FIRST: 'Paid in advance',
};

interface Line {
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

function itemsTable(items: Line[], total: number): string {
  const rows = items
    .map(
      (i) =>
        `<tr>
           <td style="padding:6px 12px 6px 0">${i.name}</td>
           <td style="padding:6px 12px 6px 0;text-align:center">${i.quantity}</td>
           <td style="padding:6px 0;text-align:right">${peso(i.lineTotal)}</td>
         </tr>`
    )
    .join('');
  return `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0">
     <thead><tr style="border-bottom:1px solid #e2e8e4">
       <th style="text-align:left;padding:6px 12px 6px 0;color:#888;font-weight:600">Item</th>
       <th style="text-align:center;padding:6px 12px 6px 0;color:#888;font-weight:600">Qty</th>
       <th style="text-align:right;padding:6px 0;color:#888;font-weight:600">Amount</th>
     </tr></thead>
     <tbody>${rows}</tbody>
     <tfoot>
       <tr><td colspan="2" style="padding:8px 12px 2px 0;text-align:right;color:#888">Delivery</td><td style="padding:8px 0 2px;text-align:right;color:${BRAND_GREEN};font-weight:600">FREE</td></tr>
       <tr><td colspan="2" style="padding:2px 12px 0 0;text-align:right;font-weight:bold">Total</td><td style="padding:2px 0 0;text-align:right;font-weight:bold;font-size:16px">${peso(total)}</td></tr>
     </tfoot>
   </table>`;
}

// Confirms an order to the buyer.
export async function sendShopOrderReceiptEmail(p: {
  to: string;
  name: string;
  code: string;
  items: Line[];
  total: number;
  paymentMethod: string;
}): Promise<SendResult> {
  const cod = p.paymentMethod === 'CASH_ON_DELIVERY';
  const trackUrl = `${appOrigin()}/shop/order/${p.code}`;

  const html = emailShell(
    'Order Confirmation',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">Thank you for your order! 🎉</h2>
     <p>Hi ${p.name}, we have received your JuanPalaman order. Here is what is on its way to you.</p>
     <p style="text-align:center;margin:16px 0">
       <span style="display:inline-block;border:2px dashed ${BRAND_GREEN};border-radius:10px;padding:10px 20px">
         <span style="display:block;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#888">Order number</span>
         <span style="display:block;font-size:20px;font-weight:bold;letter-spacing:2px;color:${BRAND_GREEN}">${p.code}</span>
       </span>
     </p>
     ${itemsTable(p.items, p.total)}
     <p style="background:#eef7f1;border-left:4px solid ${BRAND_GREEN};padding:10px 14px">
       <strong>Payment:</strong> ${PAY_LABEL[p.paymentMethod] ?? p.paymentMethod}.
       ${cod ? 'Please have the exact amount ready when your order arrives.' : 'Thank you — we will confirm your payment and dispatch your order.'}
       <br><strong>Delivery is free.</strong>
     </p>
     <p>We will contact you on the number you gave to arrange delivery. You can also check your order any
     time here:</p>
     <p style="text-align:center;margin:18px 0">
       <a href="${trackUrl}" style="border:2px solid ${BRAND_GREEN};color:${BRAND_GREEN};text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:bold;display:inline-block">Check my order</a>
     </p>
     <p style="color:#888;font-size:13px">Questions? Just reply to this email.</p>`
  );
  return send(p.to, `Your JuanPalaman order ${p.code}`, html, 'shop receipt');
}

// Tells the owner a new order has come in, with everything needed to dispatch it.
export async function sendShopOrderOwnerAlert(p: {
  to: string;
  order: {
    code: string;
    name: string;
    phone: string;
    email: string | null;
    address: string;
    landmark: string | null;
    customerType: string;
    paymentMethod: string;
    total: number;
    items: Line[];
    hasProof: boolean;
  };
}): Promise<SendResult> {
  const o = p.order;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:5px 14px 5px 0;color:#888;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:5px 0">${value}</td></tr>`;

  const html = emailShell(
    'New Shop Order',
    `<h2 style="margin:0 0 8px;color:${BRAND_GREEN};font-size:18px">New order ${o.code} — ${peso(o.total)}</h2>
     <p><strong>${o.name}</strong> placed an order on the JuanPalaman shop
     ${o.customerType === 'REPEAT' ? '<span style="color:' + BRAND_GREEN + '">(repeat customer)</span>' : '(new customer)'}.</p>
     ${itemsTable(o.items, o.total)}
     <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
       ${row('Payment', (o.paymentMethod === 'CASH_ON_DELIVERY' ? 'Cash on delivery' : 'Paid in advance') + (o.hasProof ? ' — proof attached in the app' : ''))}
       ${row('Mobile', `<a href="tel:${o.phone}" style="color:${BRAND_GREEN}">${o.phone}</a>`)}
       ${o.email ? row('Email', `<a href="mailto:${o.email}" style="color:${BRAND_GREEN}">${o.email}</a>`) : ''}
       ${row('Deliver to', o.address)}
       ${o.landmark ? row('Landmark', o.landmark) : ''}
     </table>
     <p style="color:#888;font-size:13px">Open <strong>Marketing &rsaquo; Shop Orders</strong> to confirm
     and dispatch it.</p>`
  );
  return send(p.to, `New order ${o.code}: ${o.name} — ${peso(o.total)}`, html, 'shop owner alert');
}
