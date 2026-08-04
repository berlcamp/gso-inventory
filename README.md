# RIS & Inventory System — LGU Ozamiz City

Office supplies inventory and issuance for the **General Services Office (GSO)**.
Departments file supply requests, GSO approves and records every release, the receiving
office signs for what arrived, and each office's remaining balance updates as it happens.

## How it works

Each office carries a **remaining balance per item** for the fiscal year, loaded from the
2026 *Inventory by Office* sheet. Releasing supplies draws that balance down, and every
movement is written to a ledger.

```
Supply officer files  →  Department head endorses  →  GSO approves (may trim quantities)
                              ↘ rejects                   ↘ rejects
                                                    →  GSO records the release  ↘ partial release
                                                    →  Receiving office confirms receipt
                                                                                ↘ reports a discrepancy
```

Every handover is signed twice: by GSO when the supplies go out, and by the office that
received them. The two cannot be the same person. Reporting a discrepancy changes no
balances — it records what the office counted and flags the release for GSO, who settles
it with a stock adjustment so the correction stays visible in the ledger.

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
| **GSO Custodian** | Approve, release, resolve discrepancies, adjust balances, maintain catalog and offices |
| **Department Head** | Endorse or reject their own office's requests; confirm receipt |
| **Supply Officer** | File requests, confirm receipt, view balances **for their own office only** |

Confirming receipt is scoped to the office the supplies went to, and never to the person
who recorded the release — one account cannot both hand goods over and sign that they
arrived.

**One person can cover several departments.** Under **Admin → Users**, pick a *primary
office* (what shows on their profile, and what a new request defaults to) and tick any
others under *Also acts for*. Their roles apply the same way in every office listed — a
supply officer covering two departments files, and a department head covering two
endorses, for both. Everything else follows: their requests list, dashboard, inventory,
and notifications span all of their offices, and the new-request form gains an office
picker as soon as there is more than one to choose from.

Every office needs at least one supply officer before it can file requests. Add them under
**Admin → Users** — pick the office and tick *Supply Officer*.

## Screens

| Route | Purpose |
|---|---|
| `/dashboard` | Pending requests, awaiting release, awaiting confirmation, discrepancies, units issued, low stock, pipeline, recent activity |
| `/dashboard/requests` | All requests with status and receipt filters, office filter, search |
| `/dashboard/requests/new` | File a request — item type-ahead showing remaining balance |
| `/dashboard/requests/[id]` | Endorse, approve, reject, release (full or partial), cancel; confirm receipt or report a discrepancy per release; full history |
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
