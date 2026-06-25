import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { badRequest, forbidden, notFound, conflict } from '../../lib/errors';
import { priceLines, round2 } from '../../lib/pricing';
import { poNumber, saleNumber } from '../../lib/numbering';
import { applyStockMovement, notifyLowStock } from '../inventory/inventory.service';
import { adjustMana } from '../mana/mana.service';
import { sendPoSubmittedEmail, sendStockRequestEmail } from '../../lib/email';
import { notifyRecipients } from '../../lib/notify';

export const poRouter = Router();
poRouter.use(authenticate);
poRouter.use(requirePermission('purchase-orders'));

// Org fields exposed on a PO so documents (e.g. PDF) can show full party details.
const orgSelect = {
  id: true,
  name: true,
  type: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  address: true,
} as const;

const createSchema = z.object({
  distributionType: z.enum(['TRADE', 'DROP_SHIP']).default('TRADE'),
  paymentMethod: z.enum(['CASH', 'MANA']).default('CASH'),
  note: z.string().max(500).optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
  // Optional: for a Principal stock-in, email this production/factory address the request.
  productionEmail: z.string().email().optional(),
  // Drop-ship delivery details (required when distributionType is DROP_SHIP).
  recipientName: z.string().optional(),
  recipientAddress: z.string().optional(),
  recipientPhone: z.string().optional(),
  landmark: z.string().optional(),
  // Proof of payment (required for drop-ship) — uploaded together with the PO.
  proofOfPayment: z
    .object({ fileName: z.string().min(1), mimeType: z.string().min(1), dataBase64: z.string().min(1) })
    .optional(),
  items: z
    .array(z.object({ productId: z.string(), quantity: z.number().int().positive() }))
    .min(1),
});

// GET /purchase-orders — POs where buyer OR seller is in the requester's scope.
poRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.scopeOrgIds!;
    const status = req.query.status as string | undefined;

    // Optional order-date range filter.
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (req.query.from) createdAt.gte = new Date(req.query.from as string);
    if (req.query.to) {
      const end = new Date(req.query.to as string);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    const dateFilter = createdAt.gte || createdAt.lte ? { createdAt } : {};

    const myOrgId = req.auth!.orgId;
    // Trade POs are visible to the buyer, seller, and upstream (oversight).
    // Drop-ship POs bypass intermediate tiers — visible only to the buyer and
    // the seller (the Principal), so they never "pass through" the Provincial.
    const visibility = {
      OR: [
        { buyerOrgId: myOrgId },
        { sellerOrgId: myOrgId },
        {
          AND: [
            { distributionType: 'TRADE' as const },
            { OR: [{ buyerOrgId: { in: scope } }, { sellerOrgId: { in: scope } }] },
          ],
        },
      ],
    };

    const orders = await prisma.purchaseOrder.findMany({
      where: {
        AND: [visibility, status ? { status: status as any } : {}, dateFilter],
      },
      include: {
        buyerOrg: { select: orgSelect },
        sellerOrg: { select: orgSelect },
        items: { include: { product: { select: { sku: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ orders });
  })
);

poRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    res.json(po);
  })
);

// POST /purchase-orders — buyer drafts a PO against its immediate parent.
poRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const buyer = await prisma.organization.findUnique({ where: { id: req.auth!.orgId } });
    if (!buyer) throw notFound('Organization not found');
    if (buyer.status !== 'APPROVED' || !buyer.isActive) {
      throw forbidden('Your organization must be approved and active to create purchase orders');
    }
    // Distributors order from their parent; the Principal has no upstream, so its
    // PO is a stock-in / restock (buyer == seller == Principal).
    const isStockIn = !buyer.parentId;
    let sellerOrgId: string;
    if (isStockIn) {
      sellerOrgId = buyer.id; // Principal restock
    } else if (body.distributionType === 'DROP_SHIP') {
      // Drop-ship ships from the Principal directly — bypass intermediate tiers
      // (and the Mana payment goes straight to the Principal too).
      const principal = await prisma.organization.findFirst({ where: { type: 'PRINCIPAL' }, select: { id: true } });
      if (!principal) throw badRequest('No Principal organization configured');
      sellerOrgId = principal.id;
    } else {
      sellerOrgId = buyer.parentId!;
    }

    const products = await prisma.product.findMany({
      where: { id: { in: body.items.map((i) => i.productId) } },
    });
    if (products.length !== new Set(body.items.map((i) => i.productId)).size) {
      throw badRequest('One or more products were not found');
    }
    const srpById = new Map(products.map((p) => [p.id, p.srp]));

    // Drop-ship orders ship directly to an end recipient, so the delivery
    // details are always required. Proof of payment is required only when NOT
    // paying with Mana — Mana is already pre-paid, so no proof is needed.
    const isDropship = body.distributionType === 'DROP_SHIP';
    let proofData: string | null = null;
    if (isDropship) {
      if (!body.recipientName || !body.recipientAddress || !body.recipientPhone) {
        throw badRequest(
          'Drop-ship orders require recipient name, complete address, and cellphone number'
        );
      }
      if (body.paymentMethod !== 'MANA' && !body.proofOfPayment) {
        throw badRequest('Drop-ship orders require an attached proof of payment (or pay with Mana)');
      }
    }
    // Proof of payment may be attached to ANY supplier order (e.g. Regular + Cash),
    // not just drop-ship. Validate/parse it whenever one is provided.
    if (body.proofOfPayment) {
      if (!ALLOWED_TYPES.includes(body.proofOfPayment.mimeType.toLowerCase())) {
        throw badRequest('Proof of payment must be an image (PNG/JPG/WEBP) or PDF');
      }
      proofData = body.proofOfPayment.dataBase64.replace(/^data:[^;]+;base64,/, '');
      if (Math.floor((proofData.length * 3) / 4) > MAX_UPLOAD_BYTES) {
        throw badRequest('Proof of payment is too large (max 3 MB)');
      }
    }

    let priced;
    if (isStockIn) {
      // Stock-in = production restock: value lines at the Principal's inventory
      // cost (manually-set production cost), falling back to SRP if none set.
      const invs = await prisma.inventory.findMany({
        where: { orgId: buyer.id, productId: { in: body.items.map((i) => i.productId) } },
        select: { productId: true, cost: true },
      });
      const costByProduct = new Map(invs.map((i) => [i.productId, i.cost]));
      const items = body.items.map((i) => {
        const srp = srpById.get(i.productId)!;
        const unitPrice = round2(costByProduct.get(i.productId) ?? srp);
        return { productId: i.productId, quantity: i.quantity, unitSrp: srp, unitPrice, lineTotal: round2(unitPrice * i.quantity) };
      });
      priced = {
        items,
        subtotal: round2(items.reduce((s, it) => s + it.unitSrp * it.quantity, 0)),
        total: round2(items.reduce((s, it) => s + it.lineTotal, 0)),
      };
    } else {
      priced = priceLines(
        body.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          srp: srpById.get(i.productId)!,
        })),
        buyer.discountRate
      );
    }

    const po = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          number: poNumber(),
          buyerOrgId: buyer.id,
          sellerOrgId,
          distributionType: body.distributionType,
          paymentMethod: body.paymentMethod,
          note: body.note ?? null,
          status: 'DRAFT',
          discountRate: buyer.discountRate,
          subtotal: priced.subtotal,
          total: priced.total,
          expectedDeliveryDate: body.expectedDeliveryDate ?? null,
          recipientName: isDropship ? body.recipientName : null,
          recipientAddress: isDropship ? body.recipientAddress : null,
          recipientPhone: isDropship ? body.recipientPhone : null,
          landmark: isDropship ? body.landmark ?? null : null,
          createdById: req.auth!.sub,
          items: { create: priced.items },
        },
        include: { items: true },
      });
      if (body.proofOfPayment && proofData) {
        await tx.poAttachment.create({
          data: {
            poId: created.id,
            kind: 'PROOF_OF_PAYMENT',
            fileName: body.proofOfPayment.fileName,
            mimeType: body.proofOfPayment.mimeType,
            size: Math.floor((proofData.length * 3) / 4),
            data: proofData,
            uploadedById: req.auth!.sub,
          },
        });
      }
      return created;
    });

    // For a Principal stock-in, optionally email the production team the request.
    let stockRequest: { sent: boolean; reason?: string } | undefined;
    if (isStockIn && body.productionEmail) {
      stockRequest = await sendStockRequestEmail({
        to: body.productionEmail,
        poNumber: po.number,
        items: priced.items.map((it) => {
          const prod = products.find((x) => x.id === it.productId)!;
          return { name: prod.name, sku: prod.sku, quantity: it.quantity };
        }),
        note: body.note,
      });
    }

    res.status(201).json({ ...po, stockRequest });
  })
);

// Status transitions ---------------------------------------------------------

// Buyer submits a DRAFT for the seller's approval.
poRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    if (po.status !== 'DRAFT') throw conflict(`Cannot submit a PO in status ${po.status}`);

    // Mana-paid orders need enough balance up front (transfer happens on approval).
    if (po.paymentMethod === 'MANA' && po.buyerOrgId !== po.sellerOrgId) {
      const buyer = await prisma.organization.findUnique({ where: { id: po.buyerOrgId }, select: { manaBalance: true } });
      if ((buyer?.manaBalance ?? 0) < po.total) {
        throw badRequest(`Not enough Mana to pay this order (need ${po.total}, have ${buyer?.manaBalance ?? 0})`);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      await tx.approval.create({
        data: {
          type: 'PO_APPROVAL',
          status: 'PENDING',
          orgId: po.buyerOrgId,
          poId: po.id,
          requestedById: req.auth!.sub,
        },
      });
      return u;
    });

    // Notify the supplier (the tier directly above) by email — the owner and any
    // active staff granted the 'purchase-orders' permission. Best effort, never
    // blocks the submission.
    let notification: { sent: boolean; reason?: string } = { sent: false };
    try {
      const recipients = await notifyRecipients(po.sellerOrgId, 'purchase-orders');
      for (const to of recipients) {
        notification = await sendPoSubmittedEmail({
          to,
          supplierName: po.sellerOrg.name,
          poNumber: po.number,
          buyerName: po.buyerOrg.name,
          total: po.total,
          distributionType: po.distributionType,
          itemsCount: po.items.length,
        });
      }
    } catch (err) {
      console.error('[po.submit] notification failed', err);
    }

    res.json({ ...updated, notification });
  })
);

// Seller (parent) approves a SUBMITTED PO.
poRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireSeller(req, po);
    if (po.status !== 'SUBMITTED') throw conflict(`Cannot approve a PO in status ${po.status}`);

    const isStockIn = po.buyerOrgId === po.sellerOrgId;
    try {
      const updated = await prisma.$transaction(async (tx) => {
        // Settle Mana: transfer credits from buyer to seller (advance payment).
        if (po.paymentMethod === 'MANA' && !isStockIn) {
          await adjustMana(tx, { orgId: po.buyerOrgId, change: -po.total, reason: 'PO_PAYMENT', refType: 'PurchaseOrder', refId: po.id });
          await adjustMana(tx, { orgId: po.sellerOrgId, change: po.total, reason: 'PO_RECEIPT', refType: 'PurchaseOrder', refId: po.id });
        }
        const u = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'APPROVED', approvedAt: new Date() },
        });
        await tx.approval.updateMany({
          where: { poId: po.id, type: 'PO_APPROVAL', status: 'PENDING' },
          data: { status: 'APPROVED', decidedById: req.auth!.sub, decidedAt: new Date() },
        });
        return u;
      });
      res.json(updated);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.startsWith('Insufficient Mana')) {
        throw badRequest(err.message);
      }
      throw err;
    }
  })
);

// Seller rejects a SUBMITTED PO.
poRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireSeller(req, po);
    if (po.status !== 'SUBMITTED') throw conflict(`Cannot reject a PO in status ${po.status}`);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'CANCELLED' },
      });
      await tx.approval.updateMany({
        where: { poId: po.id, type: 'PO_APPROVAL', status: 'PENDING' },
        data: { status: 'REJECTED', decidedById: req.auth!.sub, decidedAt: new Date(), note: 'Rejected by supplier' },
      });
      return u;
    });
    res.json(updated);
  })
);

// Seller fulfills an APPROVED PO. Trade -> deduct seller inventory + record a
// Sale for the seller. Drop-ship -> still record the Sale, but no stock change.
poRouter.post(
  '/:id/fulfill',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireSeller(req, po);
    if (po.status !== 'APPROVED') throw conflict(`Cannot fulfill a PO in status ${po.status}`);

    // A stock-in PO (Principal restock) has buyer == seller: no stock is
    // deducted and no sale is recorded — it only adds stock on receipt.
    const isStockIn = po.buyerOrgId === po.sellerOrgId;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (po.distributionType === 'TRADE' && !isStockIn) {
          for (const item of po.items) {
            await applyStockMovement(tx, {
              orgId: po.sellerOrgId,
              productId: item.productId,
              change: -item.quantity,
              reason: 'PO_FULFILLED',
              refType: 'PurchaseOrder',
              refId: po.id,
            });
          }
        }
        // Record the seller's sale generated from this PO (skip for stock-in).
        if (!isStockIn)
        await tx.sale.create({
          data: {
            number: saleNumber(),
            sellerOrgId: po.sellerOrgId,
            buyerOrgId: po.buyerOrgId,
            channel: 'PO',
            distributionType: po.distributionType,
            discountRate: po.discountRate,
            subtotal: po.subtotal,
            total: po.total,
            poId: po.id,
            createdById: req.auth!.sub,
            items: {
              create: po.items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                unitSrp: i.unitSrp,
                unitPrice: i.unitPrice,
                lineTotal: i.lineTotal,
              })),
            },
          },
        });
        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'FULFILLED', fulfilledAt: new Date() },
        });
      });
      // Low-stock reminder for the seller after a trade fulfillment.
      if (po.distributionType === 'TRADE' && !isStockIn) {
        await notifyLowStock(po.sellerOrgId, po.items.map((i) => i.productId));
      }
      res.json(updated);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.startsWith('Insufficient stock')) {
        throw badRequest(err.message);
      }
      throw err;
    }
  })
);

// Seller (Principal for drop-ship) sets/updates the shipping tracking link.
const trackingSchema = z.object({ trackingLink: z.string().trim().max(500).nullable().optional() });
poRouter.post(
  '/:id/tracking',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireSeller(req, po);
    if (po.distributionType !== 'DROP_SHIP') {
      throw badRequest('Tracking links apply to drop-ship orders only');
    }
    const { trackingLink } = trackingSchema.parse(req.body);
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { trackingLink: trackingLink || null },
    });
    res.json({ ok: true, trackingLink: updated.trackingLink });
  })
);

// Buyer records actual quantities received (supports partial receipts).
// Body: { items: [{ itemId, received }] } where `received` is the quantity
// received in THIS event. Trade -> increases buyer inventory by that amount;
// Drop-ship -> no inventory change but receipts are still tracked.
// Status becomes PARTIALLY_RECEIVED, then RECEIVED once every line is complete.
const receiveSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string(), received: z.number().int().min(0) }))
    .min(1),
});

poRouter.post(
  '/:id/receive',
  asyncHandler(async (req, res) => {
    const body = receiveSchema.parse(req.body);
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    if (po.status !== 'FULFILLED' && po.status !== 'PARTIALLY_RECEIVED') {
      throw conflict(`Cannot receive a PO in status ${po.status}`);
    }

    const itemById = new Map(po.items.map((i) => [i.id, i]));
    // Validate every line up front.
    for (const r of body.items) {
      const item = itemById.get(r.itemId);
      if (!item) throw badRequest(`Unknown PO item ${r.itemId}`);
      const newTotal = item.receivedQuantity + r.received;
      if (newTotal > item.quantity) {
        throw badRequest(
          `Received (${newTotal}) exceeds ordered (${item.quantity}) for ${item.product.name}`
        );
      }
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        for (const r of body.items) {
          if (r.received <= 0) continue;
          const item = itemById.get(r.itemId)!;
          if (po.distributionType === 'TRADE') {
            await applyStockMovement(tx, {
              orgId: po.buyerOrgId,
              productId: item.productId,
              change: r.received,
              reason: 'PO_RECEIVED',
              refType: 'PurchaseOrder',
              refId: po.id,
            });
          }
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { receivedQuantity: { increment: r.received } },
          });
        }

        // Recompute completion from fresh totals.
        const items = await tx.purchaseOrderItem.findMany({ where: { poId: po.id } });
        const fullyReceived = items.every((i) => i.receivedQuantity >= i.quantity);
        const anyReceived = items.some((i) => i.receivedQuantity > 0);
        const status = fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status;

        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status, receivedAt: fullyReceived ? new Date() : po.receivedAt },
          include: { items: { include: { product: { select: { sku: true, name: true } } } } },
        });
      });
      res.json(updated);
    } catch (err: any) {
      if (typeof err?.message === 'string' && err.message.startsWith('Insufficient stock')) {
        throw badRequest(err.message);
      }
      throw err;
    }
  })
);

// Cancel (buyer). Allowed any time before completion (RECEIVED). If the PO was
// already fulfilled/partially received, its inventory effects and generated
// sale are reversed so the books stay consistent.
poRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    // The buyer, the seller, or the Principal may cancel a PO.
    const canCancel =
      req.auth!.orgId === po.buyerOrgId ||
      req.auth!.orgId === po.sellerOrgId ||
      req.auth!.role === 'PRINCIPAL';
    if (!canCancel) throw forbidden('You are not allowed to cancel this purchase order');
    if (po.status === 'RECEIVED' || po.status === 'CANCELLED') {
      throw conflict(`Cannot cancel a PO in status ${po.status}`);
    }
    const needsReversal = po.status === 'FULFILLED' || po.status === 'PARTIALLY_RECEIVED';
    const isStockIn = po.buyerOrgId === po.sellerOrgId;
    // Mana is transferred on approval, so any approved-or-later Mana PO needs a refund.
    const manaTransferred =
      po.paymentMethod === 'MANA' && !isStockIn && ['APPROVED', 'FULFILLED', 'PARTIALLY_RECEIVED'].includes(po.status);

    const updated = await prisma.$transaction(async (tx) => {
      if (manaTransferred) {
        await adjustMana(tx, { orgId: po.buyerOrgId, change: po.total, reason: 'PO_MANA_REFUND', refType: 'PurchaseOrder', refId: po.id });
        await adjustMana(tx, { orgId: po.sellerOrgId, change: -po.total, reason: 'PO_MANA_REFUND_REVERSAL', refType: 'PurchaseOrder', refId: po.id, allowNegative: true });
      }
      if (needsReversal) {
        if (po.distributionType === 'TRADE') {
          for (const item of po.items) {
            // Return the fulfilled quantity to the seller.
            await applyStockMovement(tx, {
              orgId: po.sellerOrgId,
              productId: item.productId,
              change: item.quantity,
              reason: 'PO_CANCELLED_RESTOCK',
              refType: 'PurchaseOrder',
              refId: po.id,
              allowNegative: true,
            });
            // Remove anything the buyer had already received.
            if (item.receivedQuantity > 0) {
              await applyStockMovement(tx, {
                orgId: po.buyerOrgId,
                productId: item.productId,
                change: -item.receivedQuantity,
                reason: 'PO_CANCELLED_RETURN',
                refType: 'PurchaseOrder',
                refId: po.id,
                allowNegative: true,
              });
            }
          }
        }
        // Void the sale that was generated on fulfillment.
        await tx.saleItem.deleteMany({ where: { sale: { poId: po.id } } });
        await tx.sale.deleteMany({ where: { poId: po.id } });
        await tx.purchaseOrderItem.updateMany({
          where: { poId: po.id },
          data: { receivedQuantity: 0 },
        });
      }

      await tx.approval.updateMany({
        where: { poId: po.id, status: 'PENDING' },
        data: { status: 'REJECTED', note: 'PO cancelled' },
      });
      return tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'CANCELLED' },
      });
    });

    res.json(updated);
  })
);

// Attachments (proof of payment) ---------------------------------------------

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB original (stays under platform body limit)
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];

const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});

// List attachment metadata — visible to anyone in the PO's chain (buyer + supplier).
poRouter.get(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    const attachments = await prisma.poAttachment.findMany({
      where: { poId: po.id },
      select: {
        id: true,
        kind: true,
        fileName: true,
        mimeType: true,
        size: true,
        createdAt: true,
        uploadedBy: { select: { name: true, orgId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ attachments });
  })
);

// Upload proof of payment — only the buyer (customer) may attach.
poRouter.post(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    requireBuyer(req, po);
    const body = uploadSchema.parse(req.body);

    if (!ALLOWED_TYPES.includes(body.mimeType.toLowerCase())) {
      throw badRequest('Only images (PNG/JPG/WEBP) or PDF files are allowed');
    }
    const cleaned = body.dataBase64.replace(/^data:[^;]+;base64,/, '');
    const size = Math.floor((cleaned.length * 3) / 4);
    if (size > MAX_UPLOAD_BYTES) throw badRequest('File too large (max 3 MB)');

    const att = await prisma.poAttachment.create({
      data: {
        poId: po.id,
        fileName: body.fileName,
        mimeType: body.mimeType,
        size,
        data: cleaned,
        uploadedById: req.auth!.sub,
      },
    });
    res.status(201).json({ id: att.id, fileName: att.fileName, mimeType: att.mimeType, size: att.size });
  })
);

// Stream an attachment's content — visible to anyone in the PO's chain.
poRouter.get(
  '/:id/attachments/:attId/content',
  asyncHandler(async (req, res) => {
    const po = await loadScopedPo(req, req.params.id);
    const att = await prisma.poAttachment.findFirst({
      where: { id: req.params.attId, poId: po.id },
    });
    if (!att) throw notFound('Attachment not found');
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${att.fileName}"`);
    res.send(Buffer.from(att.data, 'base64'));
  })
);

// Helpers --------------------------------------------------------------------

async function loadScopedPo(req: any, id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { sku: true, name: true } } } },
      buyerOrg: { select: orgSelect },
      sellerOrg: { select: orgSelect },
    },
  });
  if (!po) throw notFound('Purchase order not found');
  const scope: string[] = req.scopeOrgIds;
  if (!scope.includes(po.buyerOrgId) && !scope.includes(po.sellerOrgId)) {
    throw forbidden('Purchase order is outside your access scope');
  }
  return po;
}

function requireBuyer(req: any, po: { buyerOrgId: string }) {
  if (req.auth.orgId !== po.buyerOrgId) throw forbidden('Only the buyer can perform this action');
}

function requireSeller(req: any, po: { sellerOrgId: string }) {
  if (req.auth.orgId !== po.sellerOrgId) throw forbidden('Only the seller can perform this action');
}
