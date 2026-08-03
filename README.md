# RIS & Inventory System — LGU Ozamiz City

Office supplies inventory and issuance for the **General Services Office (GSO)**.
Departments file supply requests through the system or walk up to the counter; GSO
approves and records every release, and each office's remaining balance updates as it
happens.

## How it works

Each office carries a **remaining balance per item** for the fiscal year, loaded from the
2026 *Inventory by Office* sheet. Releasing supplies draws that balance down, and every
movement is written to a ledger.

```
Supply officer files a request  →  GSO approves (may trim quantities)  →  GSO records the release
                                          ↘ rejects                            ↘ partial release
```

Walk-ins are recorded in one step and deduct immediately.

## Setup

### 1. Environment

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

### 2. Database

Apply the migrations in `supabase/migrations/` in filename order — via the Supabase SQL
editor, or:

```bash
npx supabase db push
```

| Migration | What it does |
|---|---|
| `20260731000001_create_gso_inventory_schema.sql` | Schema, tables, enums, stock RPCs, RLS, grants |
| `20260731000002_seed_roles_permissions.sql` | Roles and permissions |
| `20260731000003_seed_baseline_inventory.sql` | 28 offices, 27 categories, 22 units, 390 items, 1,476 opening balances |
| `20260731000004_super_admin_setup.sql` | The first administrator — **edit the email before applying** |
| `20260731000005_seed_supply_officers.sql` | Supply officer per office — **fill in the emails**, or use Admin → Users |

### 3. Expose the schema to the Data API

**Required — the app cannot read anything without this.** The `gso_inventory` schema is
not public, so PostgREST ignores it until you list it.

Dashboard → **Project Settings → API** (newer UI: **Data API**) → **Exposed schemas** →
add `gso_inventory` to the existing list (append, don't replace) → **Save**.

PostgREST reloads its cache automatically after a few seconds. To force it:

```sql
NOTIFY pgrst, 'reload schema';
```

Skipping this produces `The schema must be one of the following: ...` at login.

### 4. Google OAuth

Enable the Google provider in Supabase (Authentication → Providers) and add
`https://<your-domain>/auth/callback` plus `http://localhost:3000/auth/callback` to the
redirect allow-list.

### 5. Run

```bash
npm install
npm run dev
```

Sign in with the Google account you set as super admin in migration 4.

## Troubleshooting login

| What you see | Cause | Fix |
|---|---|---|
| **Could Not Reach the Database** — `The schema must be one of the following: …` | `gso_inventory` is not in the Data API's exposed schemas | Step 3 above |
| **Access Denied** | Sign-in worked, but no profile matches your Google account | Run `supabase/diagnostics/check_access.sql` |
| **Account Deactivated** | The profile exists with `is_active = false` | Admin → Users → reactivate |

`supabase/diagnostics/check_access.sql` walks the whole chain — migrations applied,
`auth.users` vs. profile match, email whitespace/casing, the FK on `user_profiles.id`,
and grants/policies for the `authenticated` role. It ends with a `DO` block that binds
your profile to your real auth UID and grants the admin role.

A common trap: migration 4 looks up the GSO office by code, so if migration 3 never
applied, **it inserts nothing and raises no error** — leaving you with no admin profile.

## Baseline data

The seed reconciles exactly with the source spreadsheet — 30,079 units across 1,476
office/item balances, matching both the per-office sum and the sheet's TOTAL column.
Unit labels from the sheet were normalized (`BOT`/`BOT.`/`BOTTLE` → `BOTTLE`,
`PC`/`PIECE`/`EACH` → `PIECE`, and so on), collapsing 38 spellings into 22 units.

## Roles

| Role | Can |
|---|---|
| **Administrator** | Everything, including user management |
| **GSO Head** | View all offices, approve requests, view reports |
| **GSO Custodian** | Approve, release, walk-ins, adjust balances, maintain catalog and offices |
| **Supply Officer** | File requests and view balances **for their own office only** |

Every office needs at least one supply officer before it can file requests. Add them under
**Admin → Users** — pick the office and tick *Supply Officer*.

## Screens

| Route | Purpose |
|---|---|
| `/dashboard` | Pending requests, awaiting release, units issued, low stock, pipeline, recent activity |
| `/dashboard/requests` | All requests with status tabs, office filter, search |
| `/dashboard/requests/new` | File a request — item type-ahead showing remaining balance |
| `/dashboard/requests/[id]` | Approve, reject, release (full or partial), cancel; full history |
| `/dashboard/walk-in` | Over-the-counter issuance, deducts immediately |
| `/dashboard/inventory` | Remaining balance per office/item; stock adjustments |
| `/dashboard/movements` | Stock ledger — every movement, filterable by office, type, and date |
| `/dashboard/items` | Catalog: items, categories, units, reorder levels |
| `/dashboard/offices` | Offices and their supply officers |
| `/dashboard/reports` | Issuance by office and category, monthly trends, CSV exports |
| `/dashboard/admin/users` | Register users, assign office and roles |
| `/dashboard/admin/settings` | Fiscal year, low-stock threshold |

## Stack

Next.js 16 (App Router, React 19) · Supabase (`gso_inventory` schema) · Tailwind v4 ·
shadcn/ui on Base UI · Zod v4 · TypeScript
