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
