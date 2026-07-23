import { prisma } from '../../lib/prisma';
import { applyStockMovement, notifyLowStock } from '../inventory/inventory.service';
import { postSaleToBooks } from '../accounting/accounting.service';
import { saleNumber } from '../../lib/numbering';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Turn a delivered shop order into a real DMS sale — once. Delivery is the point
// where everything the ledger cares about is simultaneously true: the goods have
// left (deduct inventory), the money is in (recognise revenue), and the buyer is
// a real customer worth keeping. Doing it here rather than at "confirmed" means
// an order that never actually ships is never booked, so nothing has to be
// reversed.
//
// Once this runs, the rest of the system needs no special cases: the sales
// report reads the Sale, the balance sheet values inventory live from what is
// left in stock, and the P&L derives COGS from the sold quantities — all of it
// moves on its own the moment the Sale and the stock movement exist.
export async function fulfilShopOrder(orderId: string, principalOrgId: string, actorUserId: string): Promise<void> {
  const order = await prisma.shopOrder.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.saleId) return; // already booked, or gone

  // The buyer's own customer record, owned by the Principal. A repeat buyer with
  // the same mobile number reuses their record rather than spawning a duplicate,
  // which is exactly what the "new / repeat" question on the form is for.
  let customer = await prisma.customer.findFirst({
    where: { ownerOrgId: principalOrgId, phone: order.phone },
    orderBy: { createdAt: 'asc' },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: order.name,
        type: 'Consumer',
        phone: order.phone,
        address: [order.address, order.landmark ? `(${order.landmark})` : null].filter(Boolean).join(' '),
        note: order.email ? `JuanPalaman shop · ${order.email}` : 'JuanPalaman shop',
        ownerOrgId: principalOrgId,
        createdById: actorUserId,
      },
    });
  }

  // Retail buyers pay the retail price outright, so each line is priced at what
  // the order actually charged — subtotal and total match the order exactly.
  const items = order.items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    unitSrp: i.unitPrice,
    unitPrice: i.unitPrice,
    lineTotal: round2(i.unitPrice * i.quantity),
  }));

  // The atomic core: stock out, sale in, order linked. Kept tight so it always
  // fits inside the interactive-transaction window — the finance posting and the
  // low-stock check run afterwards, since both are best-effort and idempotent
  // and would only risk timing the transaction out.
  const sale = await prisma.$transaction(async (tx) => {
    // Deduct the Principal's stock. allowNegative: a delivered order is already
    // out the door — refusing the movement would leave stock overstated, which
    // is worse than showing the Principal a negative they need to reconcile.
    for (const it of items) {
      await applyStockMovement(tx, {
        orgId: principalOrgId,
        productId: it.productId,
        change: -it.quantity,
        reason: 'POS_SALE',
        refType: 'ShopOrder',
        refId: order.id,
        allowNegative: true,
      });
    }

    const created = await tx.sale.create({
      data: {
        number: saleNumber(),
        sellerOrgId: principalOrgId,
        channel: 'POS',
        distributionType: 'TRADE',
        customerName: order.name,
        customerId: customer!.id,
        discountRate: 0,
        subtotal: order.subtotal,
        total: order.total,
        onAccount: false,
        createdById: actorUserId,
        items: { create: items },
      },
    });

    await tx.shopOrder.update({ where: { id: order.id }, data: { saleId: created.id } });
    return created;
  });

  // Revenue into the books — same path the Principal's own POS sales take.
  await postSaleToBooks({
    saleId: sale.id,
    total: sale.total,
    date: sale.createdAt,
    onAccount: false,
    label: `JuanPalaman shop order ${order.code}`,
    createdById: actorUserId,
  });
  await notifyLowStock(principalOrgId, items.map((i) => i.productId)).catch(() => undefined);
}
