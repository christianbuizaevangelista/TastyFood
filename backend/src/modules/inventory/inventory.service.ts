import { Prisma } from '@prisma/client';

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
