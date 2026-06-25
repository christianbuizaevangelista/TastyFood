import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { sendLowStockEmail } from '../../lib/email';
import { notifyRecipients } from '../../lib/notify';

/**
 * Applies a stock movement for one org/product inside a transaction and writes
 * a ledger entry. Positive change = stock-in, negative = stock-out.
 * Drop-ship flows must NOT call this (seller stock is unchanged).
 */
export async function applyStockMovement(
  tx: Prisma.TransactionClient,
  params: {
    orgId: string;
    productId: string;
    change: number;
    reason: string;
    refType?: string;
    refId?: string;
    allowNegative?: boolean;
  }
): Promise<number> {
  const { orgId, productId, change, reason, refType, refId, allowNegative } = params;

  const existing = await tx.inventory.findUnique({
    where: { orgId_productId: { orgId, productId } },
  });
  const current = existing?.quantity ?? 0;
  const balance = current + change;

  if (!allowNegative && balance < 0) {
    throw new Error(
      `Insufficient stock for product ${productId} at org ${orgId} (have ${current}, need ${-change})`
    );
  }

  await tx.inventory.upsert({
    where: { orgId_productId: { orgId, productId } },
    create: { orgId, productId, quantity: balance },
    update: { quantity: balance },
  });

  await tx.stockLedger.create({
    data: { orgId, productId, change, balance, reason, refType, refId },
  });

  return balance;
}

/**
 * Checks the given org's products against their reorder level and, for any that
 * newly dropped to/below it, emails the distributor once (re-armed on restock).
 * Best-effort; runs after the stock transaction, never throws.
 */
export async function notifyLowStock(orgId: string, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  try {
    const rows = await prisma.inventory.findMany({
      where: { orgId, productId: { in: productIds } },
      include: { product: { select: { name: true, sku: true } } },
    });
    const newlyLow = rows.filter(
      (r) => r.reorderLevel != null && r.quantity <= r.reorderLevel && r.lowStockNotifiedAt == null
    );
    const recovered = rows.filter(
      (r) => r.reorderLevel != null && r.quantity > r.reorderLevel && r.lowStockNotifiedAt != null
    );

    if (newlyLow.length) {
      await prisma.inventory.updateMany({
        where: { id: { in: newlyLow.map((r) => r.id) } },
        data: { lowStockNotifiedAt: new Date() },
      });
    }
    if (recovered.length) {
      await prisma.inventory.updateMany({
        where: { id: { in: recovered.map((r) => r.id) } },
        data: { lowStockNotifiedAt: null },
      });
    }

    if (newlyLow.length) {
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
      const recipients = await notifyRecipients(orgId, 'inventory');
      const items = newlyLow.map((r) => ({ name: r.product.name, sku: r.product.sku, quantity: r.quantity, reorderLevel: r.reorderLevel! }));
      for (const to of recipients) {
        await sendLowStockEmail({ to, orgName: org?.name ?? 'Distributor', items });
      }
    }
  } catch (err) {
    console.error('[notifyLowStock]', err);
  }
}
