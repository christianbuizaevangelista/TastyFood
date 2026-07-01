import { AccountType, CashflowSection } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ASSET & EXPENSE are debit-normal; LIABILITY, EQUITY, INCOME are credit-normal.
export function isDebitNormal(type: AccountType): boolean {
  return type === 'ASSET' || type === 'EXPENSE';
}

// The signed balance of an account given its debit/credit totals (positive in its normal direction).
export function normalBalance(type: AccountType, debit: number, credit: number): number {
  return isDebitNormal(type) ? debit - credit : credit - debit;
}

interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  isCash?: boolean;
  cashflowSection?: CashflowSection;
}

// A sensible default chart of accounts for a Philippine manufacturing/distribution SME.
const DEFAULT_ACCOUNTS: SeedAccount[] = [
  // Assets
  { code: '1000', name: 'Cash on Hand', type: 'ASSET', isCash: true },
  { code: '1010', name: 'Cash in Bank', type: 'ASSET', isCash: true },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', cashflowSection: 'OPERATING' },
  { code: '1200', name: 'Inventory', type: 'ASSET', cashflowSection: 'OPERATING' },
  { code: '1500', name: 'Equipment', type: 'ASSET', cashflowSection: 'INVESTING' },
  { code: '1510', name: 'Furniture & Fixtures', type: 'ASSET', cashflowSection: 'INVESTING' },
  { code: '1520', name: 'Vehicles', type: 'ASSET', cashflowSection: 'INVESTING' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', cashflowSection: 'OPERATING' },
  { code: '2100', name: 'Loans Payable', type: 'LIABILITY', cashflowSection: 'FINANCING' },
  { code: '2200', name: 'Taxes Payable', type: 'LIABILITY', cashflowSection: 'OPERATING' },
  // Equity
  { code: '3000', name: "Owner's Capital", type: 'EQUITY', cashflowSection: 'FINANCING' },
  { code: '3100', name: "Owner's Drawings", type: 'EQUITY', cashflowSection: 'FINANCING' },
  { code: '3900', name: 'Retained Earnings', type: 'EQUITY', cashflowSection: 'FINANCING' },
  // Income
  { code: '4000', name: 'Sales Revenue', type: 'INCOME', cashflowSection: 'OPERATING' },
  { code: '4100', name: 'Other Income', type: 'INCOME', cashflowSection: 'OPERATING' },
  // Expenses
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', cashflowSection: 'OPERATING' },
  { code: '5100', name: 'Salaries & Wages', type: 'EXPENSE', cashflowSection: 'OPERATING' },
  { code: '5200', name: 'Rent Expense', type: 'EXPENSE', cashflowSection: 'OPERATING' },
  { code: '5300', name: 'Utilities', type: 'EXPENSE', cashflowSection: 'OPERATING' },
  { code: '5400', name: 'Delivery & Transportation', type: 'EXPENSE', cashflowSection: 'OPERATING' },
  { code: '5500', name: 'Office Supplies', type: 'EXPENSE', cashflowSection: 'OPERATING' },
  { code: '5600', name: 'Marketing & Advertising', type: 'EXPENSE', cashflowSection: 'OPERATING' },
  { code: '5900', name: 'Miscellaneous Expense', type: 'EXPENSE', cashflowSection: 'OPERATING' },
];

// Creates the default chart of accounts if the books are empty. Returns how many were added.
export async function ensureDefaultAccounts(): Promise<number> {
  const count = await prisma.account.count();
  if (count > 0) return 0;
  await prisma.account.createMany({ data: DEFAULT_ACCOUNTS });
  return DEFAULT_ACCOUNTS.length;
}

// Next sequential journal entry number, e.g. JE-000042.
export async function nextEntryNumber(): Promise<string> {
  const count = await prisma.journalEntry.count();
  return `JE-${String(count + 1).padStart(6, '0')}`;
}

// Fetch an account by code, creating a sensible default if it doesn't exist.
async function accountByCode(code: string, name: string, type: AccountType, cashflowSection: CashflowSection | null, isCash: boolean) {
  const existing = await prisma.account.findUnique({ where: { code } });
  if (existing) return existing;
  return prisma.account.create({ data: { code, name, type, isCash, cashflowSection } });
}

// Auto-posts an operations sale (POS or fulfilled PO) into the finance books as
// revenue. Idempotent per sale (via JournalEntry.sourceType/sourceId). Best-effort:
// it must never break the originating sale/PO flow.
export async function postSaleToBooks(p: {
  saleId: string;
  total: number;
  date: Date;
  onAccount: boolean; // true = credit sale (PO on account) -> Debit A/R; false = cash (POS) -> Debit Cash
  label: string;
  createdById: string;
}): Promise<void> {
  try {
    if (!p.total || p.total <= 0) return;
    const existing = await prisma.journalEntry.findFirst({ where: { sourceType: 'SALE', sourceId: p.saleId } });
    if (existing) return;
    await ensureDefaultAccounts();
    const revenue = await accountByCode('4000', 'Sales Revenue', 'INCOME', 'OPERATING', false);
    const debit = p.onAccount
      ? await accountByCode('1100', 'Accounts Receivable', 'ASSET', 'OPERATING', false)
      : await accountByCode('1000', 'Cash on Hand', 'ASSET', null, true);
    const number = await nextEntryNumber();
    await prisma.journalEntry.create({
      data: {
        number,
        date: p.date,
        memo: p.label,
        sourceType: 'SALE',
        sourceId: p.saleId,
        createdById: p.createdById,
        lines: {
          create: [
            { accountId: debit.id, debit: round2(p.total) },
            { accountId: revenue.id, credit: round2(p.total) },
          ],
        },
      },
    });
  } catch (err) {
    console.error('[postSaleToBooks] failed', err);
  }
}
