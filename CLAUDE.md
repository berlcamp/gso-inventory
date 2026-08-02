# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev       # start dev server on http://localhost:3000
npm run build     # production build
npm run lint      # ESLint (Next.js config, v9 flat config in eslint.config.mjs)
```

There is no test suite.

## Architecture

**GSO Inventory System** — office supplies inventory and issuance for LGU Ozamiz City,
controlled by the General Services Office (GSO). Departments file supply requests
(through the app or as walk-ins at the counter); GSO reviews, approves, and records the
release, which draws down the requesting office's remaining balance.

Cloned from the MTOP system (`github.com/berlcamp/mtop`) — same stack, layout, auth flow,
and visual language.

### Stack

- **Next.js 16.2.3** with App Router and React 19. Read `node_modules/next/dist/docs/` before writing Next.js code — this version has breaking API changes.
- **Supabase** (`@supabase/ssr`) for auth and database. All data lives in a custom `gso_inventory` Postgres schema; every Supabase query must call `.schema("gso_inventory")` before `.from(...)`. The schema must also be listed under **Project Settings → API → Exposed schemas**, otherwise every query fails with `The schema must be one of the following: …` — see `supabase/diagnostics/check_access.sql`.
- **Tailwind v4** + **shadcn/ui** (style: `base-nova`, color: `neutral`, built on Base UI). Add new components with `npx shadcn add <component>`.
- **Zod v4** for validation (`src/lib/schemas/gso.ts`).

### The core model

Each office carries a **remaining balance per item** for the fiscal year, seeded from the
2026 "Inventory by Office" spreadsheet. A release deducts from that balance. GSO does not
keep a separate central stock number — the per-office balance *is* the inventory.

`gso_inventory.office_stocks` is one row per `(office, item, fiscal_year)`:
- `opening_quantity` — the baseline loaded from the spreadsheet
- `quantity` — what is left right now

Every change to `quantity` writes a `gso_inventory.stock_movements` row (signed quantity +
resulting balance). That ledger is the audit trail and the source for all issuance reporting.

### Request flow

`pending` → `approved` → `released`

Side exits: `rejected`, `cancelled`. `partially_released` sits between approved and released
when only some of the approved quantity has gone out.

Walk-ins skip the queue: `create_walk_in_release` writes an already-approved request and
releases it in the same transaction, tagged `source = 'walk_in'`.

### Postgres functions (all `SECURITY DEFINER`)

Stock never moves through a plain UPDATE — it always goes through an RPC so the balance
change, the ledger row, and the status transition commit together.

| Function | Purpose |
|---|---|
| `release_request(request_id, actor_id, lines, received_by, remarks)` | Deducts each line from the office balance, writes ledger rows, recomputes request status. Rejects releasing more than was approved, and — unless `allow_over_release` is on — more than the balance. |
| `adjust_stock(office_id, item_id, quantity, movement_type, actor_id, remarks)` | Replenishment, return, or manual correction. Signed quantity; refuses to go negative. |
| `create_walk_in_release(office_id, actor_id, requester_name, purpose, lines, remarks)` | One-step counter issuance; delegates to `release_request`. |

### Balance enforcement

An office can only ever draw items **it holds an allocation for**, and only from
**its own** `office_stocks` row — `release_request` takes the office id from the request
row, never from caller input, so there is no path to another office's balance.

The quantity limit is checked in three places, and they must agree:

| Where | Checks against |
|---|---|
| `createRequest` | `balance - committed` |
| `approveRequest` | `balance - committed`, excluding the request being approved |
| `release_request` (RPC) | raw `balance` |

`committed` is what other **approved but not yet collected** requests have spoken for.
Without subtracting it, two requests could each be approved for the whole balance and the
second would only fail at the counter. `loadAvailability()` in `requests.ts` computes it;
`getRequestAvailability()` exposes the same arithmetic to the approve screen so the number
on screen matches what submitting will enforce. The release dialog deliberately caps on
raw `balance` instead, mirroring the RPC — a request must not be blocked by its own
commitment.

**`allow_over_release`** (admin → settings) waives the quantity ceiling in all three
places, letting a balance go negative; the ledger still records every movement. It never
waives the allocation requirement — a missing `office_stocks` row is still an error, since
creating one would invent an allocation no fiscal-year baseline granted.

The fiscal year for a new request comes from `system_settings`, not the wall clock, and is
written onto the request explicitly. `office_stocks` is keyed by fiscal year and the RPC
reads the year back off the request, so validating against a different year than the row
receives would let a bad line through.

### Auth Flow

Google OAuth only. There is **no `middleware.ts`** — session refresh runs through
`src/proxy.ts` (exported as `proxy`, not `middleware`), picked up via the `config.matcher`
export in that file.

OAuth callback at `/auth/callback/route.ts`:
1. Exchanges the code for a session.
2. Looks up `gso_inventory.user_profiles` by `id`, then by `email` for pre-registered users.
3. On first login of a pre-registered user, migrates the placeholder profile to the real auth UID using the admin client.
4. Redirects unauthorized or deactivated users to `/auth?error=...` and signs them out.

### Supabase Client Files

| File | Usage |
|---|---|
| `src/lib/supabase/server.ts` | Server Components and Route Handlers — reads cookies via `next/headers` |
| `src/lib/supabase/client.ts` | Client Components — singleton browser client |
| `src/lib/supabase/admin.ts` | Server-only — service role key, bypasses RLS; validates JWT role on init |
| `src/lib/supabase/proxy.ts` | Session refresh logic called by `src/proxy.ts` |

### Data Layer

All reads and mutations are **Server Actions** in `src/lib/actions/`:

| File | Covers |
|---|---|
| `requests.ts` | Filing, approving, rejecting, cancelling, releasing, walk-ins |
| `inventory.ts` | Office balances, stock ledger, adjustments |
| `catalog.ts` | Offices, categories, units, items, item type-ahead |
| `dashboard.ts` | KPIs, pipeline, activity, top items, low stock |
| `reports.ts` | Issuance by office/category, trends, CSV exports |
| `users.ts` | Admin user management (uses the admin client) |
| `settings.ts` | System settings |

Actions return `{ error: string | null, data: ... }` — never throw to the client.

Every action starts with `requireSession()` or `requirePermission(...)` from
`src/lib/auth/session.ts`, which resolves the profile and the effective permission codes.
That module is deliberately **not** `"use server"` so it can export types and constants.

`requireSession` is wrapped in React `cache()`, so the auth chain (`auth.getUser()` plus
one profile query and one nested roles→permissions query) runs **once per request** no
matter how many actions a page awaits. Do not unwrap it — a page calling four actions
would go back to paying for four auth round trips before fetching any real data.

### Permission scoping

Authorization is enforced in server actions, not RLS (RLS gates access to authenticated
users only). The key distinction is `request.view_all`:

- Holders (admin, GSO head, GSO custodian) see and act on every office.
- Without it, a supply officer is scoped to `profile.office_id` for requests, balances, ledger, and dashboard figures.

Roles seeded in migration 2: `admin`, `gso_head`, `gso_custodian`, `supply_officer`.

### Migrations

`supabase/migrations/`, applied in order:

1. `..._create_gso_inventory_schema.sql` — schema, tables, enums, RPCs, RLS, grants
2. `..._seed_roles_permissions.sql` — roles and permissions
3. `..._seed_baseline_inventory.sql` — **generated** from the 2026 CSV: 28 offices, 27 categories, 22 units, 390 items, 1,476 opening balances (30,079 units, reconciles to the sheet total)
4. `..._super_admin_setup.sql` — first admin; drops the `user_profiles.id` FK to `auth.users` so placeholder profiles are allowed
5. `..._seed_supply_officers.sql` — template: fill in each office's Google email
6. `..._release_request_honor_over_release.sql` — replaces `release_request` so it reads the `allow_over_release` setting instead of always refusing an over-balance release

### Types

`src/types/database.ts` is hand-maintained. Regenerate with:
```bash
npx supabase gen types typescript --project-id <id> --schema gso_inventory > src/types/database.ts
```

### Component Structure

- `src/components/ui/` — shadcn primitives (do not hand-edit, with one exception below)
- `src/components/layout/` — `AppSidebar`, `Topbar`, `PageHeader`, `NavigationProgress`
- `src/components/shared/` — `StatusBadge`, `MovementBadge`, `RequestStepper`, `TimelineLog`
- `src/components/tables/` — the TanStack `DataTable` and its toolbar, faceted filter, pagination, sortable header, skeleton, and CSV export
- `src/components/gso/` — `ItemLineEditor`, the item picker shared by the request and walk-in forms

**Local edit to the primitives:** `Input`, `Textarea`, and `SelectTrigger` were changed
from `bg-transparent` to `bg-card` so form fields read as white against this theme's grey
page background (`--background` is #F0F2F5; `--card` is the white surface — `bg-background`
would be the *grey*). The `dark:bg-input/30` fill is untouched, because `bg-card` in dark
mode is the panel colour and a field would disappear into it. Re-running
`npx shadcn add input|textarea|select` reverts this — reapply it after.

### Route Structure

All authenticated routes live under `/dashboard`. The dashboard layout is a **Server
Component**: it resolves `getSessionSnapshot()` once and hands it to `SessionProvider`
(`src/lib/hooks/use-session.tsx`), which backs `useAuth`, `useProfile`, and
`usePermissions`. Those hooks do **no** fetching — permission checks are correct on the
first render, and adding a call site costs nothing.

Page files (`page.tsx`) are Server Components that call server actions and pass data down;
interactive logic lives in a sibling `*-content.tsx` / `*-form.tsx` Client Component. Pages
are `export const dynamic = "force-dynamic"`.

Each list page awaits nothing above its `<Suspense>` boundary, so the header paints
immediately and the rows stream in behind a `<DataTableSkeleton />`. Every list route also
has a `loading.tsx` for arriving from another route.

### List pages

Inventory, requests, movements, and items are **client-side tables**
(`src/components/tables/data-table.tsx`, TanStack Table). The page fetches *every* row it
is allowed to see via a `getAllX()` action and hands it over; filtering, sorting, and
paging then happen in the browser with no server round trip.

Filters are the faceted style: a dashed-outline trigger, a searchable checklist, and live
per-option counts from the faceted row model. They are **multi-select** — the filter value
is a `string[]`, so any filterable column needs
`filterFn: (row, id, value) => value.includes(row.getValue(id))`. Filter state lives in the
component, not the URL, so list pages are no longer linkable to a filtered view.

Columns filter on **ids** but sort and display **names** (`accessorFn` returns
`row.office?.id`, with an explicit `sortingFn` comparing codes). Filter options come from
the full lookup tables, not from the loaded rows, so an empty result still shows why. A
column that only exists to be filtered on (stock level, request source) is hidden through
`initialColumnVisibility` — hidden columns still filter and facet.

Two constraints worth keeping in mind:

- **Column definitions contain functions**, so they can only be built inside a Client
  Component. Passing them from a `page.tsx` fails at runtime with "Functions cannot be
  passed directly to Client Components".
- **`getAllStockMovements` is capped** at 5,000 rows because the ledger grows with every
  release, unlike the other tables. The page renders a notice when it is showing a slice.
  If the ledger routinely exceeds this, that page needs to go back to server-side paging.

Reports still filters server-side through `useFilterNav` (`src/lib/hooks/use-filter-nav.ts`),
because its figures are aggregated in SQL rather than derived from rows in the browser.

### Environment Variables

Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # service_role JWT — used only in admin.ts
```

This project shares a Supabase project with MTOP; the schemas keep the data separate, but
`auth.users` is common to both.
