import { Router, Request } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { assertAllowedUploadType } from '../../lib/upload';
import { sendShopOrderReceiptEmail, sendShopOrderOwnerAlert } from '../../lib/email.shop';
import { principalOwnerEmail } from './public.service';

// The public JuanPalaman shop at /shop — no login. Ads point here; the buyer
// picks products, fills in delivery details, and pays first or on delivery.
export const shopRouter = Router();

// Orders must clear this before they can be placed. Delivery is free, so the
// floor is what makes each drop worth dispatching.
export const MIN_ORDER = 1000;
const MAX_QTY = 200;
const MAX_PROOF_BYTES = 3 * 1024 * 1024;

const MAX_PER_IP_PER_HOUR = 10;
function hashIp(req: Request): string | null {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = fwd || req.socket.remoteAddress || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newOrderCode(): string {
  const pick = (n: number) =>
    Array.from(crypto.randomBytes(n)).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `JP-${pick(4)}-${pick(4)}`;
}

function retailPrice(p: { retailSrp: number | null; srp: number }): number {
  return p.retailSrp ?? p.srp;
}

// GET /public/shop — the products on sale and the order rules.
shopRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      where: { isActive: true, shopVisible: true },
      orderBy: { srp: 'asc' },
      select: { id: true, name: true, size: true, description: true, srp: true, retailSrp: true, category: true },
    });
    res.json({
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        size: p.size,
        description: p.description,
        category: p.category,
        price: retailPrice(p),
      })),
      minOrder: MIN_ORDER,
      deliveryFee: 0,
      payments: ['CASH_ON_DELIVERY', 'PAY_FIRST'],
    });
  })
);

const orderSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(7).max(40),
  email: z.string().email().max(160).optional().or(z.literal('')),
  address: z.string().min(1).max(400),
  landmark: z.string().max(200).optional(),
  customerType: z.enum(['NEW', 'REPEAT']).default('NEW'),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'PAY_FIRST']).default('CASH_ON_DELIVERY'),
  note: z.string().max(500).optional(),
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().positive().max(MAX_QTY) }))
    .min(1),
  // A pay-first buyer may attach proof up front; a COD buyer never needs to.
  proof: z
    .object({ fileName: z.string().min(1), mimeType: z.string().min(1), dataBase64: z.string().min(1) })
    .optional(),
  website: z.string().max(200).optional(), // honeypot
});

// POST /public/shop/order — place an order.
shopRouter.post(
  '/order',
  asyncHandler(async (req, res) => {
    const b = orderSchema.parse(req.body);
    if (b.website && b.website.trim().length > 0) {
      return res.status(201).json({ ok: true, code: null });
    }

    const ipHash = hashIp(req);
    if (ipHash) {
      const recent = await prisma.shopOrder.count({
        where: { ipHash, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (recent >= MAX_PER_IP_PER_HOUR) {
        throw badRequest('Too many orders from this connection. Please try again later.');
      }
    }

    // Prices always come from the database, never from the client — a posted
    // price is a posted discount waiting to happen.
    const ids = [...new Set(b.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, isActive: true, shopVisible: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    if (products.length !== ids.length) {
      throw badRequest('One or more items are no longer available. Please refresh and try again.');
    }

    const lines = b.items.map((i) => {
      const p = byId.get(i.productId)!;
      const unitPrice = retailPrice(p);
      return {
        productId: p.id,
        name: `${p.name}${p.size ? ` ${p.size}` : ''}`,
        unitPrice,
        quantity: i.quantity,
        lineTotal: Math.round(unitPrice * i.quantity * 100) / 100,
      };
    });
    const subtotal = Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

    if (subtotal < MIN_ORDER) {
      throw badRequest(
        `The minimum order is ₱${MIN_ORDER.toLocaleString()}. Your order is ₱${subtotal.toLocaleString()} — please add a little more.`
      );
    }

    // Pay-first proof, if attached now.
    let proofData: string | null = null;
    let proofName: string | null = null;
    let proofMimeType: string | null = null;
    if (b.paymentMethod === 'PAY_FIRST' && b.proof) {
      assertAllowedUploadType(b.proof.mimeType);
      const data = b.proof.dataBase64.replace(/^data:[^;]+;base64,/, '');
      if (Math.floor((data.length * 3) / 4) > MAX_PROOF_BYTES) throw badRequest('Proof file too large (max 3 MB)');
      proofData = data;
      proofName = b.proof.fileName;
      proofMimeType = b.proof.mimeType;
    }

    const order = await prisma.shopOrder.create({
      data: {
        code: newOrderCode(),
        name: b.name.trim(),
        phone: b.phone.trim(),
        email: b.email?.trim().toLowerCase() || null,
        address: b.address.trim(),
        landmark: b.landmark?.trim() || null,
        customerType: b.customerType,
        paymentMethod: b.paymentMethod,
        subtotal,
        deliveryFee: 0,
        total: subtotal,
        note: b.note?.trim() || null,
        proofData,
        proofName,
        proofMimeType,
        ipHash,
        items: { create: lines },
      },
      include: { items: true },
    });

    res.status(201).json({
      ok: true,
      code: order.code,
      total: order.total,
      paymentMethod: order.paymentMethod,
    });

    // Best-effort emails. An order must never be lost to a mail problem.
    if (order.email) {
      sendShopOrderReceiptEmail({
        to: order.email,
        name: order.name,
        code: order.code,
        items: order.items,
        total: order.total,
        paymentMethod: order.paymentMethod,
      }).catch((e) => console.error('[shop] receipt failed', e?.message));
    }
    principalOwnerEmail()
      .then((owner) =>
        owner
          ? sendShopOrderOwnerAlert({
              to: owner,
              order: {
                code: order.code,
                name: order.name,
                phone: order.phone,
                email: order.email,
                address: order.address,
                landmark: order.landmark,
                customerType: order.customerType,
                paymentMethod: order.paymentMethod,
                total: order.total,
                items: order.items,
                hasProof: !!order.proofData,
              },
            })
          : null
      )
      .catch((e) => console.error('[shop] owner alert failed', e?.message));
  })
);

// GET /public/shop/order/:code — a buyer checking their own order.
shopRouter.get(
  '/order/:code',
  asyncHandler(async (req, res) => {
    const order = await prisma.shopOrder.findUnique({
      where: { code: req.params.code.trim().toUpperCase() },
      include: { items: true },
    });
    if (!order) throw notFound('Order not found');
    res.json({
      code: order.code,
      name: order.name,
      status: order.status,
      paymentMethod: order.paymentMethod,
      total: order.total,
      placedAt: order.createdAt,
      items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
    });
  })
);
