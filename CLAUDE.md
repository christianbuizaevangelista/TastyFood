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
   - **A new table arrives with RLS off.** Every table in `public` has Row-Level Security enabled with zero policies, which is what keeps the Supabase Data API from reading anything. `db push` does not carry that over, so after any push that creates a table, run:
     ```sql
     DO $$ DECLARE t record; BEGIN
       FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
       LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname); END LOOP;
     END $$;
     ```
     `ENABLE`, never `FORCE` — the app connects as `postgres`, which has BYPASSRLS, and `FORCE` would apply the policy to it too and break every query.
2. **Clear the Ignored Build Step FIRST** (else the build auto-cancels):
   `PATCH https://api.vercel.com/v9/projects/{PROJECT_ID}?teamId={TEAM_ID}` body `{"commandForIgnoringBuildStep":""}`
3. **Relink Git:** `POST https://api.vercel.com/v9/projects/{PROJECT_ID}/link?teamId={TEAM_ID}` body `{"type":"github","repo":"christianbuizaevangelista/TastyFood"}`
4. **Deploy `main` to production:** `POST https://api.vercel.com/v13/deployments?teamId={TEAM_ID}` body `{"name":"tasty-food-manufacturing-inc","project":"tasty-food-manufacturing-inc","target":"production","gitSource":{"type":"github","repoId":{REPO_ID},"ref":"main"}}`
5. **Poll** `GET https://api.vercel.com/v13/deployments/{DEPLOY_ID}?teamId={TEAM_ID}` until `readyState` is `READY`; then verify `GET https://tastyfoodph.vercel.app/api/health` → `{"status":"ok"}`. (The live domain is **tastyfoodph.vercel.app** — `tasty-food-manufacturing-inc.vercel.app` is not an alias and always answers `DEPLOYMENT_NOT_FOUND`.)
   - **`CLIENT_ORIGIN` must match that same live domain.** Every link the backend puts in an email is built from it (`appOrigin()` in `backend/src/lib/email.ts`), so pointing it at the non-alias silently ships dead buttons to real recipients while the app itself looks perfectly healthy. `/api/health` echoes it back as `origin` — **check that field on every release**, because nothing else surfaces a wrong value until it reaches someone's inbox.
6. **Re-freeze:** `DELETE https://api.vercel.com/v9/projects/{PROJECT_ID}/link?teamId={TEAM_ID}` (disconnect Git) so future demo pushes don't hit live.

All calls use header `Authorization: Bearer {VERCEL_TOKEN}`. DEMO needs none of this — it auto-deploys on push. Note: demo runs its own Supabase DB (region `sin1`), official runs the real DB (region `hnd1`).

## Rules
- **No secrets in the repo** (this repo is public). DB connection strings, JWT secret, Resend key, API tokens and `ZOOM_DEFAULT_LINK` live only in Vercel env vars and the local, git-ignored `backend/.env`. The Zoom link counts as a secret because it carries its own passcode — committing it would let anyone join a meeting.
- To run locally you need `backend/.env` with `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `CLIENT_ORIGIN` (ask the owner).
- **`backend/.env` must point at the DEMO database, never at official.** A local file wired to the live company DB turns any stray script into a production incident. Official credentials are not kept on disk at all — pull them from the Vercel project only when a release needs `prisma db push`, use them in-memory, and delete them afterwards. Never write them to a file inside the repo: `.gitignore` now covers every `.env*` variant, but the safest secret is the one that was never written down.
- Commit + push only when asked. Match existing code style.
