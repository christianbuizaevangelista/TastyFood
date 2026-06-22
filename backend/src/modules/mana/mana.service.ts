import { Prisma } from '@prisma/client';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Adjusts an org's Mana balance inside a transaction and writes a ledger row.
 * Positive change = credit, negative = debit. Throws on insufficient balance
 * unless allowNegative is set.
 */
export async function adjustMana(
  tx: Prisma.TransactionClient,
  params: {
    orgId: string;
    change: number;
    reason: string;
    refType?: string;
    refId?: string;
    allowNegative?: boolean;
  }
): Promise<number> {
  const org = await tx.organization.findUnique({ where: { id: params.orgId } });
  if (!org) throw new Error('Organization not found');
  const balance = round2((org.manaBalance ?? 0) + params.change);
  if (!params.allowNegative && balance < 0) {
    throw new Error(`Insufficient Mana (balance ${org.manaBalance}, need ${-params.change})`);
  }
  await tx.organization.update({ where: { id: params.orgId }, data: { manaBalance: balance } });
  await tx.manaTxn.create({
    data: {
      orgId: params.orgId,
      change: round2(params.change),
      balance,
      reason: params.reason,
      refType: params.refType,
      refId: params.refId,
    },
  });
  return balance;
}
