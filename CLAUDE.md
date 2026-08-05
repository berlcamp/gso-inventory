# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev       # start dev server on http://localhost:3000
npm run build     # production build
npm run lint      # ESLint (Next.js config, v9 flat config in eslint.config.mjs)
npm run test      # Vitest (config in vitest.config.mts — it does not read tsconfig paths)
```

The suite covers pure logic only — `src/**/*.test.ts`: `notifications/feed.test.ts`,
`requests/receipt.test.ts`, `requests/visibility.test.ts`. Nothing mocks Supabase, so
anything worth testing has to be extractable as a plain function first; that constraint is
the point. Request visibility is the clearest case — the rule is pure, the consequence of
getting it wrong is a leak, and pulling it out of the actions is what made it testable.

## Architecture

**RIS & Inventory System** — office supplies inventory and issuance for LGU Ozamiz City,
controlled by the General Services Office (GSO). Departments file supply requests; GSO
reviews, approves, and records the release, which draws down the requesting office's
remaining balance; the receiving office then signs for what actually arrived.

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
- `opening_quantity` — the baseline: what the office was allocated for the year
- `quantity` — what is left right now

Every change to `quantity` writes a `gso_inventory.stock_movements` row (signed quantity +
resulting balance). That ledger is the audit trail and the source for all issuance reporting.

**Issuance is read from the ledger, never as `opening_quantity - quantity`.** Those two
columns move independently: an `opening` movement raises both (a baseline is granted,
nothing was issued), a `replenishment` raises only `quantity` (stock arrived on top of the
baseline). The subtraction is only equal to issuance on a row whose sole movements are
releases — true of untouched seeded rows and nothing else, which is why stocking a newly
catalogued item with 10,000 units used to render as "Issued −10,000". `office_stock_issued`
sums the release movements instead; `getAllOfficeStocks` attaches the result as
`OfficeStockRow.issued`, and `getStockForExport` reads the same RPC so the inventory page
and the stock-balance report cannot disagree. Returns are **not** netted off — `reports.ts`
keeps releases and returns in separate columns on the grounds that how to treat a return is
the reader's judgement.

Baselines for items added after the spreadsheet load come from the `opening` movement type
in `adjust_stock` (admin → inventory → Adjust Stock → "Opening balance"), which is the only
path that writes `opening_quantity`. The enum had `opening` from migration 1 but nothing
could reach it until migration 10.

### Request flow

`awaiting_endorsement` → `pending` → `recommended` → `approved` → `released`

A supply officer files; the requesting office's **own department head** endorses it; only
then does GSO see it. So `pending` means exactly "endorsed, on GSO's desk" and nothing
else — which is why the extra stage is its own status rather than a flag on `pending`.
Every GSO-side query already filters on `status`, so they all became correct without
being touched. A boolean would have left `pending` meaning two things and every GSO read
having to remember a second predicate; miss one and un-endorsed requests leak to GSO,
which is the exact bypass this stage exists to prevent.

The head **endorses at quantities of their own** (migration 17) — the one stage that can
raise a line as well as cut one. They know what the office actually needs and the supply
officer filing on their behalf can be wrong in either direction; an increase is capped at
`balance - committed`, so an endorsement can never promise stock that is not there.

**`recommended` is the GSO checker's stage** (migration 16), added for the same reason and
by the same shape. A **GSO Checker** goes down an endorsed slip line by line, cuts each
quantity to what GSO can actually grant, and recommends it; only then can the **GSO Head**
approve. The head cannot approve out of `pending` at all — one predicate in
`approveRequest`, which is what a status buys and a flag would not.

**Four signatures, four columns**, and every stage after endorsement can only cut:

| Column | Whose number | Ceiling |
|---|---|---|
| `quantity_requested` | the supply officer who filed | — |
| `quantity_endorsed` | their department head | `balance - committed` (not a constraint — it depends on other requests) |
| `quantity_recommended` | the GSO checker | `quantity_endorsed`, CHECK constraint |
| `quantity_approved` | the GSO head | `quantity_recommended`, CHECK constraint |

Each is its own column rather than an overwrite of the one before: they are different
people's numbers, a request showing an approved quantity before anyone approved it is a
lie the page would have to keep telling, and a raised line is only attributable to the
head who raised it if the filed figure survives beside it. The detail table shows
Req. / End. / Rec. / Appr. for that reason. A NULL reads as "this stage has not spoken
yet" — every ceiling COALESCEs down the chain, which is what keeps requests filed before
either migration working.

`request.recommend` is held by `gso_checker` and admin, and deliberately by **not**
`gso_custodian` — that role already holds `request.approve`, and both in one pair of hands
is the thing this stage exists to prevent. Admin holds both as the escape hatch, the same
one that lets admin endorse when an office's head is away. **Nothing moves past `pending`
until somebody holds the role**; migration 16's closing `SELECT` reports how many requests
are waiting and how many people can move them.

**A slip is editable until it is endorsed, and only then.** `updateRequest` rewrites the
purpose, the remarks, and the item list — lines added and removed included — and is open to
both desks on the requesting office's own side: `request.create` (the supply officer who
files) or `request.endorse` (the head who is about to endorse), plus the office match every
department-side action runs. Deliberately **not** `request.approve`: GSO's answer to a
request it cannot fill is to cut it at their own stage, not to rewrite what the office
asked for. The edit lives at `/dashboard/requests/[id]/edit`, reusing the new-request
form's `ItemLineEditor`; the quantities are re-checked against `balance - committed` exactly
as filing does, so an edit can no more promise absent stock than a fresh slip can.

The window closes at endorsement because from `pending` on the slip carries other people's
numbers, and each is a ceiling read off the one below it. Cutting a filed quantity under an
existing endorsement would leave the head's figure above it — the one thing every check
downstream assumes cannot happen. This is also why editing is not a substitute for
`cancelRequest`, which stays open through `recommended`: withdrawing a slip invalidates
nothing, rewriting one does.

A head editing here does overwrite `quantity_requested`, the supply officer's own column.
What keeps that attributable is the `updated` log entry: `describeRequestChanges` records
every line that moved with **both** of its numbers, so the filed figure survives on the
timeline rather than being silently replaced. The `updated` action has been in the
`request_action` enum since migration 1 and needed no migration to reach.

Side exits: `rejected`, `cancelled`. `partially_released` sits between approved and released
when only some of the approved quantity has gone out. Rejection is terminal at either
stage — there is no edit-and-resubmit flow past endorsement, so a slip corrected after it
reaches GSO is filed as a new request.
The head can reject at `pending` or `recommended`, so a junk slip is never stuck waiting to
be checked first. A request is cancellable while `awaiting_endorsement`, `pending`, or
`recommended` — i.e. right up to GSO's approval, since nothing is committed before it.

**Filing requires the office to have a department head.** `createRequest` refuses when the
requesting office has no active user holding the `department_head` role — the slip would
otherwise park at `awaiting_endorsement` with nobody able to move it, failing silently days
later instead of at the moment someone can still fix it. Migration 9 is the seed template
for filling those in; its closing `SELECT` lists the offices that still cannot file.

**Walk-ins are gone** (migration 12). Over-the-counter issuance used to write an
already-approved request and release it in one step; it was the only flow that produced an
issuance nobody in the requesting office ever signed for. `request_source` and
`requests.source` survive because Postgres cannot drop an enum value and rows tagged
`walk_in` are real history — but nothing can create one, and `request.walk_in` no longer
exists.

### Receipt confirmation — the second signature

Recording a release is the custodian's word: `released_by` is stamped by the RPC and
`received_by_name` is free text the same custodian types in. **Acknowledgement is the
requesting office's own signature on top of that**, and it hangs off a *release event*,
not the request — a request can be handed over across several trips, and a single flag on
`requests` would be wrong the moment a second batch went out after the first was signed
for. Before migration 14 a batch had no identity at all, so "what went out on Tuesday" was
not reconstructable.

- `request_releases` — one row per `release_request` call. `ack_status` is
  `pending | confirmed | disputed | waived`; `waived` is written only by the backfill, for
  releases that predate the feature and can never legitimately be signed.
- `request_release_items` — `quantity_issued` (the custodian's count) beside
  `quantity_received` (the office's).
- `stock_movements.release_id` ties each ledger row to the trip that produced it.

Two rules live in `acknowledge_release`, not the UI, because they are the point:
the acknowledger **cannot be the person who released** (a supply officer confirming their
own handover is no signature at all), and must belong to the **receiving office**.
`releaseAckEligibility` in `src/lib/requests/receipt.ts` mirrors them so the page can
explain a hidden button rather than just hiding it; the RPC is the authority.

**A dispute moves no stock.** It records what the office counted and flags the release;
GSO settles the balance with `adjust_stock`. That keeps the ledger with exactly one author
and makes a shortfall a visible correction rather than a department editing inventory.
`quantity_received` is deliberately *not* capped at `quantity_issued` — over-delivery is a
discrepancy too, and refusing to record it would force the office to sign for a number it
knows is wrong. Editing a quantity and pressing Confirm still lands as `disputed`: a
mismatch is a dispute whatever button produced it.

`resolveReleaseDispute` is GSO's answer. It sets `dispute_resolved_*` and leaves
`ack_status` at `disputed` — the dispute happened, and clearing it would erase the record.
Resolution exists so the queues can empty: a dispute nobody can close would light the bell
forever and everyone would learn to ignore it.

Rolled up per request by `rollUpReceipt` (worst-first: disputed → pending → confirmed →
waived) for the list column, the dashboard tiles, and the stepper's last step.

### Postgres functions (all `SECURITY DEFINER`)

Stock never moves through a plain UPDATE — it always goes through an RPC so the balance
change, the ledger row, and the status transition commit together.

| Function | Purpose |
|---|---|
| `release_request(request_id, actor_id, lines, received_by, remarks)` | Opens a `request_releases` header, deducts each line from the office balance, writes its release lines and ledger rows, recomputes request status. Rejects releasing more than was approved, more than the balance unless `allow_over_release` is on, and a blank `received_by` — the receiver's name is half of the two-party record. Deletes the header again if no line actually moved, so an empty receipt never lands in anyone's queue. |
| `acknowledge_release(release_id, actor_id, lines, remarks, dispute)` | The receiving office's counter-signature. Omit `lines` to confirm exactly as issued. Refuses the releaser, another office, a second acknowledgement, a reasonless dispute, and a "dispute" where nothing differs. Writes `received` or `disputed` to `request_logs`. **Moves no stock.** |
| `adjust_stock(office_id, item_id, quantity, movement_type, actor_id, remarks)` | Opening balance, replenishment, return, or manual correction. Signed quantity; refuses to take either the balance or the baseline negative. `movement_type = 'opening'` moves `opening_quantity` in step with `quantity`; every other type moves the balance alone. |
| `office_stock_issued(fiscal_year, office_id)` | Total released per office+item, summed from the ledger. Read-only. Takes an explicit office filter because it is `SECURITY DEFINER` — callers without `request.view_all` pass their own office. |

### Balance enforcement

An office can only ever draw items **it holds an allocation for**, and only from
**its own** `office_stocks` row — `release_request` takes the office id from the request
row, never from caller input, so there is no path to another office's balance.

The quantity limit is checked in six places, and they must agree:

| Where | Checks against |
|---|---|
| `createRequest` | `balance - committed` |
| `updateRequest` | `balance - committed`, excluding the request being edited |
| `endorseRequest` | `balance - committed`, excluding the request being endorsed |
| `recommendRequest` | `balance - committed`, excluding the request being checked |
| `approveRequest` | `balance - committed`, excluding the request being approved |
| `release_request` (RPC) | raw `balance` |

`endorseRequest` is the one that matters most: it is the only stage that can *raise* a
quantity, so its check is the whole ceiling on an increase rather than a re-run of
something already enforced. The balance can also have moved since filing.

`recommendRequest` runs the check the approval will run rather than skipping it as a
read-only stage: recommending a number the head then cannot approve moves the failure one
desk further from the person who could still have fixed it. It is on top of the
recommendation's own ceiling — a checker can never recommend more than was endorsed.

`updateRequest` reads the fiscal year **off the request**, not from settings: the row
already carries one, `office_stocks` is keyed by it, and `release_request` reads it back
off the request — so checking against a year that has since rolled over in settings would
validate a different shelf than the release will draw from. It excludes its own request
from `committed` for the same reason the approve screen does; at `awaiting_endorsement`
nothing the slip asked for is committed yet, so that exclusion is a no-op today and a
correctness guard if the editable window ever moves.

`committed` is what other **approved but not yet collected** requests have spoken for.
Without subtracting it, two requests could each be approved for the whole balance and the
second would only fail at the counter. `loadAvailability()` in
`src/lib/inventory/availability.ts` computes it — that module is plain functions, not
`"use server"`, so both the write paths and the item picker can share one arithmetic.
`getRequestAvailability()` exposes the same numbers to the approve screen so what is on
screen matches what submitting will enforce. The release dialog deliberately caps on raw
`balance` instead, mirroring the RPC — a request must not be blocked by its own
commitment.

**The picker never offers what the checks would reject.** `searchItemsForOffice()` reads
the office's own `office_stocks` rows for the settings fiscal year rather than the
catalog, so an item the office holds no allocation for — or has nothing left of — is not
in the list at all. Its ceiling is `balance - committed`, matching the check downstream in
`createRequest`/`approveRequest`. (It used to be mode-dependent — walk-ins capped on the
raw balance — until migration 12 left one flow.) An empty query lists the office's whole
shelf, which is now a useful size.

Stock adjustments are the deliberate exception and use `searchCatalogForOffice()` instead:
`adjust_stock` opens an allocation row for an item the office has never carried, so
replenishing is exactly the case where "the office has none of it" must not hide the item.

**`allow_over_release`** (admin → settings) waives the quantity ceiling in all three
places, letting a balance go negative; the ledger still records every movement, and the
picker widens back to the office's full allocation so a zeroed item can still be put on a
slip. It never waives the allocation requirement — a missing `office_stocks` row is still
an error, since creating one would invent an allocation no fiscal-year baseline granted.

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
3. On first login of a pre-registered user, migrates the placeholder profile to the real auth UID using the admin client. **Both `user_roles` and `user_offices` are read before the delete and re-inserted against the new id** — they cascade off the profile row, so a user assigned to several offices would otherwise lose all but their primary the first time they signed in, with the admin screen still showing the assignment.
4. Redirects unauthorized or deactivated users to `/auth?error=...` and signs them out.

**Two components decide who is signed in, and they must not disagree.** The proxy knows
only `auth.users`; the dashboard layout additionally requires a usable `user_profiles`
row. A valid Google session with no usable profile therefore satisfies one and fails the
other — and with the proxy bouncing every authenticated request off `/auth`, the two sent
the user back and forth until the browser gave up with `ERR_TOO_MANY_REDIRECTS`, in place
of the page that would have said why. Three rules keep that closed:

- **The proxy bounces only the bare login page, and only without `?error=`.** Sub-routes
  are exempt because `/auth/callback` *establishes* the session and `/auth/signout`
  *clears* it — bouncing them would discard the OAuth code and strand the cookie.
- **Denying access must clear the cookie on the response being returned.**
  `supabase.auth.signOut()` writes its expiry through `next/headers`, a different channel
  from the `NextResponse` a route handler constructs, so a denied account could otherwise
  keep a live session. `clearAuthCookies` (`src/lib/auth/cookies.ts`) does it explicitly;
  the callback's `deny()` and `/auth/signout` both go through it.
- **A layout cannot clear a cookie**, so it redirects to `/auth/signout?reason=…`, which
  can. That route is why an unusable session ends rather than merely being redirected.

`getSessionSnapshot()` returns `{ session }` or `{ session: null, reason, detail }`, and
`requireSession` throws `SessionError` carrying that reason. **`lookup_failed` is kept
distinct from `unauthorized`**: an unexposed schema or a revoked grant also returns no
profile row, and telling someone their account is unregistered when the database is simply
unreachable sends them to the administrator to fix an account that was never broken.

### Office scope — one person, several departments

`user_profiles.office_id` is the **primary** office: what the topbar shows, what a new
request defaults to, what the auth callback copies. It is *not* what authorization reads.

`gso_inventory.user_offices` (migration 15) is the set of offices a user acts for.
**Roles stay global to the user** — `user_roles` says what someone may do, `user_offices`
says where. That is exactly the "same role in several departments" case; per-office roles
would mean threading an office argument through every permission check, and nothing needs
it.

`SessionContext.officeIds` is the **union** of the two, and is the only thing any check
should read:

- `ctx.officeIds.includes(officeId)` — via `canActForOffice` in `requests.ts`
- `.in("office_id", ctx.officeIds)` — every scoped list query
- `releaseAckEligibility` takes `officeIds`, mirroring the RPC

The union cannot over-grant, since the primary is itself a real assignment, and it means a
membership row that somehow went missing degrades to the old single-office behaviour
instead of locking someone out of their own office. `acknowledge_release` runs the same
union in SQL, and it is the authority — the client mirror only exists so the page can
explain a hidden button.

`updateUser` rewrites both wholesale (that is what makes un-assigning possible) and folds
the primary into the set, so the two can never disagree.

Consequences worth knowing: `office_stock_issued` takes one office and is `SECURITY
DEFINER`, so a multi-office user calls it once per office and the results are merged —
passing NULL would return every office in the city. The new-request form shows an office
picker as soon as someone covers more than one, and the offices page lists a person under
every office they cover, not just their primary.

**Every `user_profiles` ⇄ `offices` embed must name its foreign key.** PostgREST reads
`user_offices` as a junction table — two foreign keys, and a primary key made of exactly
those two columns — and therefore publishes a **many-to-many** route between the two
tables *in addition to* the direct `user_profiles.office_id` column. An unqualified
`office:offices(...)` is then ambiguous and the whole query fails with `Could not embed
because more than one relationship was found`; write `office:offices!office_id(...)`.

This is the trap in the change, because the failure lands nowhere near the cause. Every
call site already named its key by convention except the one in `requireSession`, so
adding the table broke **session resolution itself** — every page, for every user, with
an error mentioning only PostgREST. Embeds where `user_offices` is the *base* table
(`from("user_offices").select("office:offices…")`) have one candidate and were never
ambiguous; the hint is written there anyway to match the convention.

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
| `requests.ts` | Filing, editing before endorsement, endorsing, recommending, approving, rejecting, cancelling, releasing, acknowledging receipt, resolving discrepancies |
| `inventory.ts` | Office balances, stock ledger, adjustments |
| `catalog.ts` | Offices, categories, units, items, item type-ahead |
| `dashboard.ts` | KPIs, pipeline, activity, top items, low stock |
| `reports.ts` | Issuance by office/category, trends, CSV exports |
| `users.ts` | Admin user management (uses the admin client) |
| `settings.ts` | System settings |
| `notifications.ts` | The topbar bell's feed |

Actions return `{ error: string | null, data: ... }` — never throw to the client.

Logic shared *between* action files, or that needs to be unit-testable, goes in a plain
module under `src/lib/` (`inventory/availability.ts`, `notifications/feed.ts`) rather than
in one action file imported by another — a `"use server"` module may only export async
functions, so a helper living there cannot be exported at all. Type-only exports are the
exception and are fine in an action file, since they erase at compile time.

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

- Holders (admin, GSO head, GSO custodian, GSO checker) see and act on every office —
  **for requests, only from `pending` on**; see below.
- Without it, a supply officer or department head is scoped to `profile.office_id` for requests, balances, ledger, and dashboard figures.

**`request.view_all` starts at `pending`, not at filing.** A request is visible two ways,
and `src/lib/requests/visibility.ts` is the one place that says so:

- it belongs to one of the viewer's own offices — **any** stage, unendorsed included
- it **reached GSO's desk**, and the viewer holds `request.view_all`

Before this, `view_all` meant every request at every stage, which handed the GSO side an
office's slips while they were still an internal draft — filed, unendorsed, nobody outside
the department having agreed they should be asked for. GSO has no business with a request
until the office's own head signs it, and the queues already said so: the checker works
`pending`, the head works `recommended`. Seeing further back than you can act is not scope,
it is a leak. A GSO checker who is also their own office's supply officer — one account,
both roles, which is the common case in a small LGU — therefore sees their own department
end to end and everyone else's only once endorsed.

The single exception is `request.endorse` **together with** `request.view_all`, which is
admin and only admin: the escape hatch for an office whose head is away. Endorsing a slip
you cannot see is not a thing, so the visibility follows the verb rather than being a
special case for a role name. Admin's view is therefore total, terminal slips included.

**"Reached GSO's desk" is a question about history, not only about status**, and that is why
`STATUS_RULE` is a record of rules rather than two lists of statuses. Three kinds:

| Kind | Statuses | Visible to `view_all` |
|---|---|---|
| pre-GSO | `awaiting_endorsement` | no — own offices only |
| live | `pending`, `recommended`, `approved`, `partially_released`, `released` | yes |
| terminal | `rejected` → `reviewed_at`, `cancelled` → `endorsed_at` | only if that column is set |

A slip the department **rejected at endorsement** and one **GSO rejected** both read
`rejected`, and `endorsed_at` cannot separate them: the head's rejection stamps it too
(that is deliberate — it is an endorsement-stage decision). `reviewed_at` can, because only
GSO's own decision writes it. A **cancelled** slip is the mirror image: nobody reviewed it,
so the endorsement that put it on GSO's desk is the only proof it ever got there. Both were
verified against live data — the two `cancelled` rows in the database have `endorsed_at`
NULL, i.e. withdrawn before the head ever saw them, and both are now hidden from other
offices.

The one thing this costs: a request **cancelled at `pending` before migration 7** existed
(no endorsement stage, so `endorsed_at` is NULL) would read as "never reached GSO" and be
hidden. Reconstructing the truth for those rows means reading `request_logs`, which is a
join per row for a case the pipeline can no longer produce. It fails closed, which is the
direction a visibility rule should fail.

That module exports three things and they answer for every read: `canViewRequest` (one row —
the detail page, its logs, its releases, its availability, the dashboard activity feed),
`requestQueryScope` (a query — `all`, an office list, or `split`), and
`requestVisibilityOrFilter` (the `split` case as a PostgREST `or`). `split` is the case a
nullable office list gets wrong: own offices at every stage *plus* every office that reached
GSO is neither an `.in()` nor an unfiltered read, and returning "no filter" for it is
exactly the leak. Queries that already name their statuses — every dashboard tile, every
notification bucket — get `all` or an office list instead and never need the `or`; a
terminal status stays `split`, since a column and not the status decides it.

The `or` is generated from `STATUS_RULE`, so the SQL and `canViewRequest` cannot disagree
about which column decides what:

```
office_id.in.(…),
status.in.(pending,recommended,approved,partially_released,released),
and(status.eq.rejected,reviewed_at.not.is.null),
and(status.eq.cancelled,endorsed_at.not.is.null)
```

Every clause is positive — `in.()` and `not.is.null` inside `and()` — rather than a negation
of the hidden set, because the hidden set is the part that depends on a column and
`not (A and B)` is the shape that goes wrong quietly. `.or()` supplies the enclosing
parentheses itself (`or=(…)`), so the string must not carry them. The whole expression was
run against the project's PostgREST before being committed; nested `and()` and `not.is.null`
inside `or` are both accepted, which is not something the unit tests can tell you.

`canViewRequest` takes `endorsed_at` and `reviewed_at` as **optional** — most callers read a
request whose status cannot be terminal. A missing stamp reads as "never reached GSO", so
forgetting the columns in a `select` hides a request rather than leaking it: a visible bug,
in the safe direction.

`getRequestLogs` and `getRequestAvailability` had no office check at all before this; the
list hid another office's slip and the URL handed it over anyway. Reports are deliberately
untouched: `reports.view` is admin/GSO-head/custodian only and its figures are aggregates,
not slips — `getRequestStatusCounts` still counts every office's `awaiting_endorsement` as
a number.

Roles: `admin`, `gso_head`, `gso_custodian`, `supply_officer` (migration 2),
`department_head` (migration 7), and `gso_checker` (migration 16).

**The GSO checker** holds `request.recommend` plus `request.view`, `request.view_all`, and
`inventory.view` — and deliberately **not** `request.approve`. The queue is GSO-wide from
`pending` on, so the checker is unscoped there like the rest of the GSO side;
`inventory.view` is what they trim against.

**Department heads** hold `request.endorse` plus `request.view` and `inventory.view` — and
deliberately **not** `request.create`. Heads review what their supply officer files; they do
not file themselves, so there is no self-endorsement case to reason about.

"Their department head" is resolved by role plus office: any active user holding
`department_head` whose `user_profiles.office_id` matches the request's office. There is no
FK on `offices` for this — `offices.head_name` stays a display label — and an office may
have more than one head, any of whom can endorse. `endorseRequest` and the endorsement
branch of `rejectRequest` re-check that office match server-side via `canActForOffice`, so
a head can never act on another office's slip. `request.view_all` holders are deliberately
exempt from that scoping, so admin can always unblock a request when an office's head is
unavailable.

`rejectRequest` serves both stages and picks the rule from the request's current status:
`awaiting_endorsement` needs `request.endorse` **and** the office match;
`pending`/`recommended`/`approved` needs `request.approve`. Holding one permission never
lets someone reject at the other's stage. The head's rejection stamps
`endorsed_by`/`endorsed_at` (an endorsement decision), GSO's stamps
`reviewed_by`/`reviewed_at`. `request.recommend` carries no rejection of its own — the
checker's answer to a line they cannot fill is to recommend zero, and the head can still
reject the whole slip at `pending` without waiting for it to be checked.

### Notifications

The topbar bell is **derived, not stored**. "Needs your action" is entirely a function of
`requests.status` plus the viewer's permissions and office, so there is no notifications
table, no migration, and nothing that can fall out of step with the request it describes.
The price is that there is no per-item read state — an item leaves the bell when the
request actually moves, which is the only thing that should clear it.

`getNotifications` fires one bucket per verb the caller's permissions justify, and each
bucket reuses the *same* predicate the matching action enforces:

"Own offices" below means `ctx.officeIds` — the whole set, not just the primary.

The request queues take their office scope from `requestQueryScope` on the bucket's own
statuses rather than from a local `canViewAll ? null : officeIds`. Today the two agree
everywhere — no `view_all` holder except admin can endorse — but a bell that offered
someone an unendorsed slip the list hides and the detail page refuses would be advertising
work the server denies, which is the one thing this feed must never do. Now it cannot.

| Kind | Permission | Status | Scope |
|---|---|---|---|
| `endorse` | `request.endorse` | `awaiting_endorsement` | own offices; every office only with `request.view_all` **and** `request.endorse` (admin) |
| `check` | `request.recommend` | `pending` | own offices unless `request.view_all` |
| `review` | `request.approve` | `recommended` | own offices unless `request.view_all` |
| `dispute` | `request.release` | releases `disputed` and unresolved | own offices unless `request.view_all` |
| `release` | `request.release` | `approved`, `partially_released` | own offices unless `request.view_all` |
| `confirm` | `request.acknowledge` | releases `pending`, not released by me | own offices; scoped users only |
| `pickup` | *(filer)* | `approved`, `partially_released` | `requested_by = me` |
| `outcome` | *(filer)* | `rejected`, `released`, last 7 days | `requested_by = me` |

`confirm` and `dispute` are keyed on **releases**, not requests, so unlike the others they
can name a request another bucket also names. `buildFeed` discounts the overlap it can
see; past the fetch window the badge can overcount by the collisions in the tail, which is
the honest trade for not inventing a number.

That reuse is load-bearing: a bell that drifted from its action would advertise work the
server then refuses, which is worse than no bell.

**The buckets are disjoint by status so their exact counts can simply be summed.**
`check` and `review` stay disjoint for free — `pending` is the checker's queue and
`recommended` is the head's, and an admin who holds both permissions gets each request in
exactly one of them. `release` and `pickup` are the pair that would collide — both read
`approved | partially_released` — so `pickup` is skipped entirely for `request.release`
holders, who get the more actionable verb. `buildFeed` still dedupes defensively and
discounts only the overlap it can actually observe in the fetched rows, never guessing at
rows beyond the `.limit(20)`.

Each bucket asks PostgREST for `{ count: "exact" }` alongside its 20 rows, so the badge
stays honest past the listed slice — a GSO desk with 34 pending slips badges 34, not 20.

The badge counts actionable items **only**. Outcomes are news, and nothing but time clears
them, so counting them would leave every user with a badge that never reaches zero.
Actionable rows sort oldest-first (a work queue — longest wait on top); outcomes sort
newest-first (a feed).

The feed is client state, so `revalidatePath` does not reach it. `NotificationBell`
refreshes on a 60s poll, on window focus, and on `usePathname()` change — the last is what
drops the badge the moment you endorse something and land back on the list.

### Migrations

`supabase/migrations/`, applied in order:

1. `..._create_gso_inventory_schema.sql` — schema, tables, enums, RPCs, RLS, grants
2. `..._seed_roles_permissions.sql` — roles and permissions
3. `..._seed_baseline_inventory.sql` — **generated** from the 2026 CSV: 28 offices, 27 categories, 22 units, 390 items, 1,476 opening balances (30,079 units, reconciles to the sheet total)
4. `..._super_admin_setup.sql` — first admin; drops the `user_profiles.id` FK to `auth.users` so placeholder profiles are allowed
5. `..._seed_supply_officers.sql` — template: fill in each office's Google email
6. `..._release_request_honor_over_release.sql` — replaces `release_request` so it reads the `allow_over_release` setting instead of always refusing an over-balance release
7. `..._department_head_approval.sql` — the `awaiting_endorsement` status and `endorsed` action, the `endorsed_by`/`endorsed_at` columns, and the `department_head` role plus `request.endorse`
8. `..._request_default_awaiting_endorsement.sql` — points `requests.status`'s default at the new stage. Separate from 7 on purpose: Postgres refuses to *use* an enum value in the transaction that added it
9. `..._seed_department_heads.sql` — template: fill in each office's Google email. Its closing `SELECT` lists offices that still have no head and therefore cannot file
10. `..._opening_balance_and_ledger_issued.sql` — replaces `adjust_stock` so the `opening` movement type sets `opening_quantity`, and so the fiscal year comes from `system_settings` rather than the wall clock (it was the last place still reading the calendar year). Adds `office_stock_issued`. Backfills a baseline onto rows an adjustment opened at zero — skipping seeded rows, where `opening_quantity = 0` is a fact from the spreadsheet rather than a missing baseline. Idempotent; its closing `SELECT` lists allocations that still have no baseline
11. `..._import_hris_department_users.sql` — pre-registers the department-side accounts by reading `hris.user_profiles` directly. The HRIS system shares this Supabase project, so the import is a cross-schema `INSERT … SELECT` rather than a transcribed email list; it maps `department_admin` → `supply_officer` and `department_head` → `department_head`, and leaves `office_id` NULL because the two systems' office codes do not line up one-for-one. An optional commented block at the bottom fills the offices in from the HRIS department code
12. `..._remove_walk_in_releases.sql` — drops `create_walk_in_release` and `request.walk_in`. See **Walk-ins are gone**
13. `..._receipt_confirmation_enum.sql` — the `received`/`disputed`/`resolved` actions, split out from 14, which writes those literals inside a function body — for the same reason 8 was split from 7
14. `..._release_receipt_confirmation.sql` — the `release_ack_status` enum, `request_releases`, `request_release_items`, `stock_movements.release_id`, and `acknowledge_release`; `release_request` is replaced to open a release header. Backfills pre-existing releases as `waived`
15. `..._users_in_multiple_offices.sql` — `user_offices`, seeded from every profile's primary office. See **Office scope**
16. `..._gso_checker_recommendation.sql` — the `recommended` status and action, `recommended_by`/`recommended_at`, `request_items.quantity_recommended` with the two ceilings as CHECK constraints, and the `gso_checker` role plus `request.recommend`. Requests already at `pending` are deliberately not backfilled — a recommendation nobody made is worse than a queue. Its closing `SELECT` reports how many slips are waiting to be checked against how many people can check them
17. `..._endorsed_quantities.sql` — `request_items.quantity_endorsed`, and the checker's ceiling moves onto it (`COALESCE(quantity_endorsed, quantity_requested)`, so slips endorsed before this keep working). No backfill: NULL there means "endorsed as filed, before the head could say otherwise", which is the truth about those rows

### Types

`src/types/database.ts` is hand-maintained. Regenerate with:
```bash
npx supabase gen types typescript --project-id <id> --schema gso_inventory > src/types/database.ts
```

### Component Structure

- `src/components/ui/` — shadcn primitives (do not hand-edit, with one exception below)
- `src/components/layout/` — `AppSidebar`, `Topbar`, `NotificationBell`, `PageHeader`, `NavigationProgress`
- `src/components/shared/` — `StatusBadge`, `MovementBadge`, `RequestStepper`, `TimelineLog`
- `src/components/tables/` — the TanStack `DataTable` and its toolbar, faceted filter, pagination, sortable header, skeleton, and CSV export
- `src/components/gso/` — `ItemLineEditor`, the item picker used by the new-request form

**Local edits to the primitives.** All are reverted by re-running
`npx shadcn add input|textarea|select|dropdown-menu` — reapply them after.

1. `Input`, `Textarea`, and `SelectTrigger` were changed from `bg-transparent` to
   `bg-card` so form fields read as white against this theme's grey page background
   (`--background` is #F0F2F5; `--card` is the white surface — `bg-background` would be
   the *grey*). The `dark:bg-input/30` fill is untouched, because `bg-card` in dark mode
   is the panel colour and a field would disappear into it.

2. `SelectContent`'s popup keeps `w-(--anchor-width)` (the trigger's width), but a long
   option is no longer cut off: `whitespace-nowrap` came off `SelectItem`'s text and
   `shrink-0` became `min-w-0 … break-words`, so it **wraps onto a second line** instead
   of overflowing into `overflow-x-hidden`, which clipped it.

   Letting the popup widen instead is the obvious-looking fix and is wrong. The only
   width cap Base UI offers is `--available-width`, which it computes against the
   **viewport** — and the popup is portalled onto a `position: fixed` positioner, so no
   ancestor bounds it. Inside the 480px Adjust Stock dialog that measured 604px, spilling
   144px past the modal. Anchor width is inherently container-safe: the trigger is
   already inside whatever box should contain the popup.

   The *trigger* keeps its `line-clamp-1` — it has a fixed width and must stay one line.

3. `SelectContent` and `DropdownMenuContent` popups were `max-h-(--available-height)`.
   Base UI computes that against the **viewport**, so inside a dialog a long list (the
   28-office picker in Adjust Stock) grew past the modal's edges instead of scrolling
   within it. Both are now a flat `max-h-72`, keeping the `overflow-y-auto` they already
   had. 288px also matches `CommandList`'s existing cap, so every list surface in the app
   tops out at the same height. Popups are portalled, so no ancestor height can bound them
   — the cap has to be on the popup itself.

Inline (non-portalled) option lists cap themselves where they are written: the item picker
in `ItemLineEditor` and the one in `AdjustStockDialog`. They scroll inside the modal
already and are not affected by the above.

4. `DialogContent` gained `*:min-w-0`. It lays its children out with `grid`, and a grid
   item's default `min-width: auto` refuses to shrink below its content's min-content
   width — so one long line (a selected item label, an office name in a Select trigger)
   widened the `<form>` past the dialog's own `max-w` and pushed every field out the right
   edge, footer included. The `truncate` that should have caught it never engaged, because
   the parent kept growing to make room. Measured at the 480px Adjust Stock dialog: an
   87-character item label produced a 606px form, 166px wider than the 440px content box;
   with `*:min-w-0` the form is exactly 440px and the label truncates. Any new dialog gets
   this automatically. `SheetContent` is `flex flex-col` and is only used by the mobile
   sidebar, so it was left alone.

5. `DialogContent` also gained `max-h-[calc(100dvh-2rem)] overflow-y-auto` — the vertical
   counterpart, and the one that actually strands a user. The popup is `fixed` and centred
   with `-translate-y-1/2`, so a dialog taller than the viewport grows past **both** edges
   at once, and a `fixed` element cannot be scrolled into view: the title and the top
   fields are simply unreachable, and the page behind it does not scroll either. The
   2rem leaves the same 1rem of breathing room top and bottom that
   `max-w-[calc(100%-2rem)]` leaves at the sides, and `dvh` keeps the footer clear of
   collapsing mobile browser chrome.

   The cap makes every dialog scroll its whole card, which is the right fallback but not
   the right default for a long *form* — the submit button ends up below the fold. The
   Add/Edit User dialog (the only one that reliably outgrows a laptop) therefore overrides
   `grid` with `flex flex-col` for itself and gives the fields `min-h-0 flex-1
   overflow-y-auto` between a pinned header and footer. Each `min-h-0` undoes a flex
   item's `min-height: auto`, which otherwise refuses to shrink below its content and puts
   the overflow straight back. Measured at 1280×700: the card sits exactly 16px off each
   edge, the fields scroll 559px, and Save never leaves the screen. Short dialogs are
   untouched — still centred, still not scrolling.

   Note `overflow-y: auto` forces `overflow-x` to compute to `auto` as well, which puts
   `DialogFooter`'s full-bleed `-mx-5` at risk of a horizontal scrollbar. It spans exactly
   the padding box, which is already inside the scrollable area, so it does not — verified,
   not assumed.

### Route Structure

All authenticated routes live under `/dashboard`. The dashboard layout is a **Server
Component**: it resolves `getSessionSnapshot()` once (redirecting to `/auth/signout` when
that comes back empty — see **Auth Flow**) and hands it to `SessionProvider`
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
