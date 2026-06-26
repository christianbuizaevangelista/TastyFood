import { Router } from 'express';
import { z } from 'zod';
import { AccountType, CashflowSection } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/http';
import { authenticate } from '../../middleware/auth';
import { requireRole, requirePermission } from '../../middleware/rbac';
import { badRequest, notFound, conflict } from '../../lib/errors';
import {
  ensureDefaultAccounts,
  nextEntryNumber,
  normalBalance,
  round2,
} from './accounting.service';

export const accountingRouter = Router();
accountingRouter.use(authenticate);
// Finance department only: Principal-org users (owner or staff with 'accounting').
// Provincial/City/Reseller roles are blocked entirely.
accountingRouter.use(requireRole('PRINCIPAL'));
accountingRouter.use(requirePermission('accounting'));

// ---- helpers ----------------------------------------------------------------
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function parseAsOf(q: any): Date {
  return q.asOf ? endOfDay(new Date(q.asOf as string)) : new Date();
}
function parseRange(q: any): { from: Date; to: Date } {
  const now = new Date();
  const from = q.from ? new Date(q.from as string) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = q.to ? endOfDay(new Date(q.to as string)) : now;
  return { from, to };
}

// =============================================================================
// Chart of Accounts
// =============================================================================

// GET /accounting/accounts — list the chart of accounts (auto-seeds defaults the first time).
accountingRouter.get(
  '/accounts',
  asyncHandler(async (_req, res) => {
    const seeded = await ensureDefaultAccounts();
    const accounts = await prisma.account.findMany({ orderBy: { code: 'asc' } });
    res.json({ accounts, seeded });
  })
);

const accountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  isCash: z.boolean().optional(),
  cashflowSection: z.enum(['OPERATING', 'INVESTING', 'FINANCING']).nullable().optional(),
});

// POST /accounting/accounts — add an account.
accountingRouter.post(
  '/accounts',
  asyncHandler(async (req, res) => {
    const body = accountSchema.parse(req.body);
    if (await prisma.account.findUnique({ where: { code: body.code } }))
      throw conflict('An account with that code already exists');
    const account = await prisma.account.create({
      data: {
        code: body.code,
        name: body.name,
        type: body.type as AccountType,
        isCash: body.isCash ?? false,
        cashflowSection: (body.cashflowSection ?? null) as CashflowSection | null,
      },
    });
    res.status(201).json(account);
  })
);

const accountUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isCash: z.boolean().optional(),
  cashflowSection: z.enum(['OPERATING', 'INVESTING', 'FINANCING']).nullable().optional(),
  isActive: z.boolean().optional(),
});

// PATCH /accounting/accounts/:id — edit an account.
accountingRouter.patch(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const body = accountUpdateSchema.parse(req.body);
    const acc = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!acc) throw notFound('Account not found');
    const updated = await prisma.account.update({
      where: { id: acc.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.isCash !== undefined ? { isCash: body.isCash } : {}),
        ...(body.cashflowSection !== undefined ? { cashflowSection: body.cashflowSection as any } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    res.json(updated);
  })
);

// GET /accounting/distributors — accounts that can owe receivables (for A/R deliveries).
accountingRouter.get(
  '/distributors',
  asyncHandler(async (_req, res) => {
    const distributors = await prisma.organization.findMany({
      where: { type: { not: 'PRINCIPAL' }, archivedAt: null },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json({ distributors });
  })
);

// GET /accounting/products — active products (for per-SKU delivery items).
accountingRouter.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, sku: true, name: true, srp: true },
      orderBy: { name: 'asc' },
    });
    res.json({ products });
  })
);

// =============================================================================
// Journal Entries
// =============================================================================

// GET /accounting/entries — list entries (optional ?from&to on entry date).
accountingRouter.get(
  '/entries',
  asyncHandler(async (req, res) => {
    const where: any = {};
    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) where.date.gte = new Date(req.query.from as string);
      if (req.query.to) where.date.lte = endOfDay(new Date(req.query.to as string));
    }
    const entries = await prisma.journalEntry.findMany({
      where,
      include: {
        lines: { include: { account: { select: { code: true, name: true, type: true } } } },
        attachments: { select: { id: true, fileName: true, mimeType: true, size: true } },
        items: true,
        distributorOrg: { select: { id: true, name: true, type: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    res.json({ entries });
  })
);

const lineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.number().min(0).optional(),
  credit: z.number().min(0).optional(),
  memo: z.string().max(200).optional(),
});
const attachmentSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});
const itemSchema = z.object({
  productId: z.string().optional(),
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().min(0),
  amount: z.number().min(0),
});
const entrySchema = z.object({
  date: z.coerce.date(),
  memo: z.string().max(300).optional(),
  reference: z.string().max(120).optional(),
  lines: z.array(lineSchema).min(2),
  attachments: z.array(attachmentSchema).max(5).optional(),
  distributorOrgId: z.string().optional(),
  deliveryReceiptNo: z.string().max(80).optional(),
  items: z.array(itemSchema).optional(),
});

const ATTACH_MAX_BYTES = 4 * 1024 * 1024; // 4 MB per receipt

// POST /accounting/entries — record a balanced journal entry.
accountingRouter.post(
  '/entries',
  asyncHandler(async (req, res) => {
    const body = entrySchema.parse(req.body);
    const lines = body.lines.map((l) => ({
      accountId: l.accountId,
      debit: round2(l.debit ?? 0),
      credit: round2(l.credit ?? 0),
      memo: l.memo ?? null,
    }));
    for (const l of lines) {
      if (l.debit > 0 && l.credit > 0) throw badRequest('A line cannot have both a debit and a credit');
      if (l.debit === 0 && l.credit === 0) throw badRequest('Each line needs a debit or a credit amount');
    }
    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    if (totalDebit !== totalCredit) throw badRequest(`Entry is not balanced (debits ${totalDebit} ≠ credits ${totalCredit})`);
    if (totalDebit === 0) throw badRequest('Entry total cannot be zero');

    const ids = [...new Set(lines.map((l) => l.accountId))];
    const found = await prisma.account.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw badRequest('One or more accounts do not exist');

    // Prepare any attached receipts (base64, size-checked).
    const attachData = (body.attachments ?? []).map((a) => {
      const data = a.dataBase64.replace(/^data:[^;]+;base64,/, '');
      const size = Math.floor((data.length * 3) / 4);
      if (size > ATTACH_MAX_BYTES) throw badRequest(`Receipt "${a.fileName}" is too large (max 4 MB)`);
      return { fileName: a.fileName, mimeType: a.mimeType, size, data, uploadedById: req.auth!.sub };
    });

    const number = await nextEntryNumber();
    const itemsData = (body.items ?? []).map((it) => ({
      productId: it.productId ?? null,
      sku: it.sku,
      name: it.name,
      quantity: it.quantity,
      unitPrice: round2(it.unitPrice),
      amount: round2(it.amount),
    }));
    const entry = await prisma.journalEntry.create({
      data: {
        number,
        date: body.date,
        memo: body.memo ?? null,
        reference: body.reference ?? null,
        createdById: req.auth!.sub,
        distributorOrgId: body.distributorOrgId ?? null,
        deliveryReceiptNo: body.deliveryReceiptNo ?? null,
        lines: { create: lines },
        ...(attachData.length ? { attachments: { create: attachData } } : {}),
        ...(itemsData.length ? { items: { create: itemsData } } : {}),
      },
      include: {
        lines: { include: { account: { select: { code: true, name: true, type: true } } } },
        attachments: { select: { id: true, fileName: true, mimeType: true, size: true } },
        items: true,
        distributorOrg: { select: { id: true, name: true, type: true } },
      },
    });
    res.status(201).json(entry);
  })
);

// GET /accounting/entries/:entryId/attachments/:attId — view/download a receipt.
accountingRouter.get(
  '/entries/:entryId/attachments/:attId',
  asyncHandler(async (req, res) => {
    const att = await prisma.journalAttachment.findUnique({ where: { id: req.params.attId } });
    if (!att || att.entryId !== req.params.entryId) throw notFound('Attachment not found');
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${att.fileName}"`);
    res.send(Buffer.from(att.data, 'base64'));
  })
);

// DELETE /accounting/entries/:id — remove an entry (and its lines).
accountingRouter.delete(
  '/entries/:id',
  asyncHandler(async (req, res) => {
    const entry = await prisma.journalEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) throw notFound('Entry not found');
    await prisma.journalEntry.delete({ where: { id: entry.id } });
    res.json({ ok: true });
  })
);

// =============================================================================
// Reports
// =============================================================================

// Aggregate debit/credit per account for entries up to/within a date filter.
async function accountTotals(dateWhere: any) {
  const accounts = await prisma.account.findMany({ orderBy: { code: 'asc' } });
  const grouped = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: { entry: dateWhere },
    _sum: { debit: true, credit: true },
  });
  const byId = new Map(grouped.map((g) => [g.accountId, { debit: g._sum.debit ?? 0, credit: g._sum.credit ?? 0 }]));
  return accounts.map((a) => {
    const t = byId.get(a.id) ?? { debit: 0, credit: 0 };
    return { account: a, debit: round2(t.debit), credit: round2(t.credit) };
  });
}

// GET /accounting/reports/trial-balance?asOf=
accountingRouter.get(
  '/reports/trial-balance',
  asyncHandler(async (req, res) => {
    const asOf = parseAsOf(req.query);
    const totals = await accountTotals({ date: { lte: asOf } });
    const rows = totals
      .map((t) => {
        const net = round2(t.debit - t.credit);
        return { code: t.account.code, name: t.account.name, type: t.account.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
      })
      .filter((r) => r.debit !== 0 || r.credit !== 0);
    res.json({
      asOf,
      rows,
      totalDebit: round2(rows.reduce((s, r) => s + r.debit, 0)),
      totalCredit: round2(rows.reduce((s, r) => s + r.credit, 0)),
    });
  })
);

// GET /accounting/reports/pnl?from&to — Profit & Loss (income statement).
accountingRouter.get(
  '/reports/pnl',
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req.query);
    const totals = await accountTotals({ date: { gte: from, lte: to } });
    const income = totals
      .filter((t) => t.account.type === 'INCOME')
      .map((t) => ({ code: t.account.code, name: t.account.name, amount: round2(t.credit - t.debit) }))
      .filter((r) => r.amount !== 0);
    const expenses = totals
      .filter((t) => t.account.type === 'EXPENSE')
      .map((t) => ({ code: t.account.code, name: t.account.name, amount: round2(t.debit - t.credit) }))
      .filter((r) => r.amount !== 0);
    const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0));
    const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
    res.json({ from, to, income, expenses, totalIncome, totalExpenses, netIncome: round2(totalIncome - totalExpenses) });
  })
);

// GET /accounting/reports/balance-sheet?asOf=
accountingRouter.get(
  '/reports/balance-sheet',
  asyncHandler(async (req, res) => {
    const asOf = parseAsOf(req.query);
    const totals = await accountTotals({ date: { lte: asOf } });
    const section = (type: AccountType) =>
      totals
        .filter((t) => t.account.type === type)
        .map((t) => ({ code: t.account.code, name: t.account.name, amount: round2(normalBalance(type, t.debit, t.credit)) }))
        .filter((r) => r.amount !== 0);

    const assets = section('ASSET');
    const liabilities = section('LIABILITY');
    const equity = section('EQUITY');
    // Net income to date isn't auto-closed to equity, so add it as current earnings.
    const netIncomeToDate = round2(
      totals.filter((t) => t.account.type === 'INCOME').reduce((s, t) => s + (t.credit - t.debit), 0) -
        totals.filter((t) => t.account.type === 'EXPENSE').reduce((s, t) => s + (t.debit - t.credit), 0)
    );
    const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
    const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
    const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0) + netIncomeToDate);
    res.json({
      asOf,
      assets,
      liabilities,
      equity,
      currentEarnings: netIncomeToDate,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: round2(totalAssets - (totalLiabilities + totalEquity)) === 0,
    });
  })
);

// GET /accounting/reports/cash-flow?from&to — direct-method Cash Flow Statement.
accountingRouter.get(
  '/reports/cash-flow',
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req.query);
    const cashAccounts = await prisma.account.findMany({ where: { isCash: true }, select: { id: true } });
    const cashIds = new Set(cashAccounts.map((a) => a.id));

    // Beginning cash = net of all cash-account movements before the period.
    const before = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: [...cashIds] }, entry: { date: { lt: from } } },
      _sum: { debit: true, credit: true },
    });
    const beginningCash = round2(before.reduce((s, g) => s + (g._sum.debit ?? 0) - (g._sum.credit ?? 0), 0));

    // Period entries that move cash.
    const entries = await prisma.journalEntry.findMany({
      where: { date: { gte: from, lte: to }, lines: { some: { accountId: { in: [...cashIds] } } } },
      include: { lines: { include: { account: { select: { isCash: true, cashflowSection: true, type: true } } } } },
    });

    const sections = { OPERATING: 0, INVESTING: 0, FINANCING: 0 };
    for (const e of entries) {
      const cashDelta = e.lines
        .filter((l) => l.account.isCash)
        .reduce((s, l) => s + l.debit - l.credit, 0); // + = cash in
      if (round2(cashDelta) === 0) continue;
      const nonCash = e.lines.filter((l) => !l.account.isCash);
      const weightTotal = nonCash.reduce((s, l) => s + Math.abs(l.debit - l.credit), 0);
      if (weightTotal === 0) {
        sections.OPERATING += cashDelta;
        continue;
      }
      for (const l of nonCash) {
        const w = Math.abs(l.debit - l.credit) / weightTotal;
        const sec = (l.account.cashflowSection ?? 'OPERATING') as keyof typeof sections;
        sections[sec] += cashDelta * w;
      }
    }
    const operating = round2(sections.OPERATING);
    const investing = round2(sections.INVESTING);
    const financing = round2(sections.FINANCING);
    const netChange = round2(operating + investing + financing);
    res.json({
      from,
      to,
      operating,
      investing,
      financing,
      netChange,
      beginningCash,
      endingCash: round2(beginningCash + netChange),
    });
  })
);
