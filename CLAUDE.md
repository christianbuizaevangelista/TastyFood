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

Needs the user's **Vercel token** (and, only for schema changes, the official DB connection). Always ask for fresh ones at release time — never commit them. Get the OFFICIAL project id, team id, and the numeric GitHub repo id from the Vercel dashboard / project settings. The frozen state means the Git link is disconnected, so the exact order below matters:

1. **(Schema changes only)** `prisma db push` against the official DB (verify the diff first; the nullable-unique-index warning is safe). No schema change → skip.
2. **Clear the Ignored Build Step FIRST** (else the build auto-cancels):
   `PATCH https://api.vercel.com/v9/projects/{PROJECT_ID}?teamId={TEAM_ID}` body `{"commandForIgnoringBuildStep":""}`
3. **Relink Git:** `POST https://api.vercel.com/v9/projects/{PROJECT_ID}/link?teamId={TEAM_ID}` body `{"type":"github","repo":"christianbuizaevangelista/TastyFood"}`
4. **Deploy `main` to production:** `POST https://api.vercel.com/v13/deployments?teamId={TEAM_ID}` body `{"name":"tasty-food-manufacturing-inc","project":"tasty-food-manufacturing-inc","target":"production","gitSource":{"type":"github","repoId":{REPO_ID},"ref":"main"}}`
5. **Poll** `GET https://api.vercel.com/v13/deployments/{DEPLOY_ID}?teamId={TEAM_ID}` until `readyState` is `READY`; then verify `GET https://tasty-food-manufacturing-inc.vercel.app/api/health` → `{"status":"ok"}`.
6. **Re-freeze:** `DELETE https://api.vercel.com/v9/projects/{PROJECT_ID}/link?teamId={TEAM_ID}` (disconnect Git) so future demo pushes don't hit live.

All calls use header `Authorization: Bearer {VERCEL_TOKEN}`. DEMO needs none of this — it auto-deploys on push. Note: demo runs its own Supabase DB (region `sin1`), official runs the real DB (region `hnd1`).

## Rules
- **No secrets in the repo** (this repo is public). DB connection strings, JWT secret, Resend key, and API tokens live only in Vercel env vars and the local, git-ignored `backend/.env`.
- To run locally you need `backend/.env` with `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `CLIENT_ORIGIN` (ask the owner).
- Commit + push only when asked. Match existing code style.
