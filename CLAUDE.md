# Tasty Food Manufacturing Inc. — project guide for Claude Code

A multi-tier distribution management system (DMS) + a separate Finance & Accounting
workspace, for Tasty Food Manufacturing Inc.

## Stack
- **Backend:** Node + Express + TypeScript + Prisma + PostgreSQL (Supabase). JWT auth, Zod, bcryptjs.
- **Frontend:** React 18 + TypeScript + Vite + Tailwind + React Router + Recharts + jsPDF.
- **Deploy:** Vercel full-stack — Vite static (`frontend/dist`) + Express as a serverless function (`api/index.ts`), `/api/*` rewrites in `vercel.json`.

## Layout
- `backend/` — Express API, Prisma schema (`backend/prisma/schema.prisma`), modules under `backend/src/modules/*`.
- `frontend/` — React app (`frontend/src/pages/*`, components, `lib/`).
- `api/index.ts` — serverless entry that mounts the Express app.
- Build: root `npm run vercel-build` (prisma generate → tsc backend → vite build frontend).

## App shape
- Two workspaces behind one login, chosen from a launcher at `/home`:
  - **Distribution Management System** (DMS) — Dashboard, POS, Purchase Orders, Inventory, Sales Report, Mana Wallet, Distribution Network (CRM), KPI, Org Structure, Customers, Referrals, Products, Downloadables, Users & Roles, Account.
  - **Finance & Accounting** (`/finance/*`, Principal + `accounting` permission only) — Dashboard, Reports (P&L / Balance Sheet / Cash Flow / Trial Balance), Journal Entries, Distributor Financials, A/R Aging, Chart of Accounts.
- Tiers: PRINCIPAL → PROVINCIAL (20%) → CITY (15%) → RESELLER (8%); plus a **RETAIL** market segment (leaf, no downline, onboarded by the Principal, its own SRP + 15%). Only the Principal onboards accounts.

## Dev + deploy workflow (IMPORTANT)
There are **two Vercel projects** on the same GitHub repo:
- **DEMO** (`tastyfood-demo`) — its own Supabase DB, seeded with fake data. **Auto-deploys on push to `main`.** Use this to build/preview everything.
- **OFFICIAL** (`tasty-food-manufacturing-inc`) — the live company app + real DB. Its **Git link is DISCONNECTED so it never auto-deploys** (stays frozen at the last release).

**Normal loop:** edit code → commit → push `main` → the DEMO redeploys automatically. Iterate on the demo.

**Release to OFFICIAL (only when the user explicitly asks, e.g. "ilabas mo na"):**
1. If the Prisma schema changed, `prisma db push` against the official DB (needs the official DB connection — ask the user).
2. In Vercel: clear the project's *Ignored Build Step*, reconnect the Git repo, deploy `main` to production, then **disconnect Git again** to re-freeze.
3. This needs the user's **Vercel token** and (for DB changes) a **Supabase token / DB connection** — always ask for fresh ones; never hardcode secrets.

## Rules
- **No secrets in the repo** (this repo is public). DB connection strings, JWT secret, Resend key, and API tokens live only in Vercel env vars and the local, git-ignored `backend/.env`.
- To run locally you need `backend/.env` with `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `CLIENT_ORIGIN` (ask the owner).
- Commit + push only when asked. Match existing code style.
