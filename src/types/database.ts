/**
 * Hand-maintained TypeScript types for the `gso_inventory` Postgres schema.
 *
 * Regenerate with:
 *   npx supabase gen types typescript --project-id <id> --schema gso_inventory > src/types/database.ts
 */

export const SCHEMA = "gso_inventory" as const

/* ── Enums ─────────────────────────────────────────────────────────────── */

export type RequestStatus =
  /** Filed, waiting on the requesting office's own department head. */
  | "awaiting_endorsement"
  /** Endorsed by the department head — now on the GSO checker's desk. */
  | "pending"
  /** Checked and cut to what GSO can grant — now on the GSO head's desk. */
  | "recommended"
  | "approved"
  | "partially_released"
  | "released"
  | "rejected"
  | "cancelled"

/**
 * `walk_in` is **legacy only** — over-the-counter issuance was retired in
 * migration 12 and nothing can create one again. The value survives because
 * Postgres cannot drop an enum member and rows already tagged with it are real
 * history the request page still has to render.
 */
export type RequestSource = "system" | "walk_in"

/**
 * Where a release stands with the office it went to.
 *
 * `waived` is written only by migration 14's backfill: those releases happened
 * before there was anything to sign, so they can never legitimately move out of
 * `pending` and must not sit in anybody's queue pretending otherwise.
 */
export type ReleaseAckStatus = "pending" | "confirmed" | "disputed" | "waived"

export type MovementType =
  | "opening"
  | "release"
  | "replenishment"
  | "return"
  | "adjustment"
  /**
   * A release taken back because the goods never physically left the
   * warehouse. Stored positive, against the release's negative, so the two net
   * to zero in `office_stock_issued` without either row being edited.
   */
  | "void"

export type RequestAction =
  | "submitted"
  | "endorsed"
  /** The GSO checker set the quantities GSO can grant and passed it upward. */
  | "recommended"
  | "approved"
  | "rejected"
  | "released"
  /** The receiving office signed for a release as issued. */
  | "received"
  /** The receiving office signed, but not for the quantities on the slip. */
  | "disputed"
  /** GSO answered a reported discrepancy. */
  | "resolved"
  /** GSO took back a released line the warehouse never actually handed over. */
  | "voided"
  | "cancelled"
  | "updated"

/* ── Tables ────────────────────────────────────────────────────────────── */

export interface Office {
  id: string
  name: string
  code: string
  head_name: string | null
  contact_number: string | null
  is_gso: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

/** One person as the offices page lists them, under either staff column. */
export interface OfficeStaff {
  id: string
  full_name: string
  email: string
  position: string | null
}

/** An office plus the active staff behind it — see `getOfficesWithOfficers`. */
export type OfficeWithStaff = Office & {
  officers: OfficeStaff[]
  heads: OfficeStaff[]
}

export interface UserProfile {
  id: string
  /**
   * The **primary** office — display and defaults only. A user can act for
   * several offices; `user_offices` is what authorization reads.
   */
  office_id: string | null
  full_name: string
  email: string
  position: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
}

export interface Role {
  id: string
  name: string
  code: string
  description: string | null
}

export interface Permission {
  id: string
  code: string
  description: string | null
}

export interface Category {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
}

export interface Unit {
  id: string
  code: string
  name: string
  created_at: string
}

export interface Item {
  id: string
  category_id: string
  unit_id: string
  name: string
  description: string | null
  reorder_level: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OfficeStock {
  id: string
  office_id: string
  item_id: string
  quantity: number
  opening_quantity: number
  fiscal_year: number
  updated_at: string
}

export interface SupplyRequest {
  id: string
  request_no: string
  office_id: string
  requested_by: string | null
  requester_name: string | null
  source: RequestSource
  status: RequestStatus
  purpose: string | null
  remarks: string | null
  fiscal_year: number
  requested_at: string
  /** The department head's sign-off — distinct from GSO's `reviewed_by`. */
  endorsed_by: string | null
  endorsed_at: string | null
  /** The GSO checker's sign-off on the quantities, before the head approves. */
  recommended_by: string | null
  recommended_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  released_by: string | null
  released_at: string | null
  received_by_name: string | null
  created_at: string
  updated_at: string
}

export interface RequestItem {
  id: string
  request_id: string
  item_id: string
  quantity_requested: number
  /**
   * What the requesting office's department head stands behind. NULL on a
   * request filed before migration 17, and on one nobody has endorsed yet —
   * read it as `quantity_endorsed ?? quantity_requested`.
   *
   * The head may raise as well as cut, capped at what the office can still
   * draw. That ceiling lives in `endorseRequest`, not in a constraint: it
   * depends on other requests, so no single row can check it.
   */
  quantity_endorsed: number | null
  /**
   * What the GSO checker says GSO can grant. NULL until someone checks it.
   * Never above the endorsed quantity — the checker cuts, never adds — and
   * `quantity_approved` can never exceed it. Both are CHECK constraints.
   */
  quantity_recommended: number | null
  quantity_approved: number | null
  quantity_released: number
  remarks: string | null
  created_at: string
}

/**
 * One trip to the counter — a single `release_request` call.
 *
 * Acknowledgement hangs off this rather than off the request because a request
 * can be handed over in several batches: a flag on `requests` would be wrong
 * the moment a second batch went out after the first was signed for.
 */
export interface RequestRelease {
  id: string
  request_id: string
  /** The custodian's attestation — who says these goods went out. */
  released_by: string | null
  released_at: string
  /** Who they were handed to, as typed by the custodian. */
  received_by_name: string | null
  remarks: string | null
  ack_status: ReleaseAckStatus
  acknowledged_by: string | null
  acknowledged_at: string | null
  ack_remarks: string | null
  /**
   * GSO's answer to a reported discrepancy. `ack_status` stays `disputed` —
   * the dispute happened, and overwriting it would erase the record. These say
   * it has been dealt with, which is what clears GSO's queue.
   */
  dispute_resolved_by: string | null
  dispute_resolved_at: string | null
  dispute_resolution: string | null
  created_at: string
}

export interface RequestReleaseItem {
  id: string
  release_id: string
  request_item_id: string
  item_id: string
  /** What the custodian says went out on this trip. */
  quantity_issued: number
  /** What the office says arrived. NULL until someone acknowledges. */
  quantity_received: number | null
  /**
   * How much of `quantity_issued` GSO has since taken back because it never
   * physically left the warehouse. Cumulative, and never more than was issued.
   * `quantity_issued` itself is left alone — it is what the custodian recorded
   * at the time, and a void is a correction on top of it, not an erasure.
   */
  quantity_voided: number
}

export interface StockMovement {
  id: string
  office_id: string
  item_id: string
  movement_type: MovementType
  quantity: number
  balance_after: number
  request_id: string | null
  /** The trip that produced this row — null for adjustments and openings. */
  release_id: string | null
  remarks: string | null
  performed_by: string | null
  created_at: string
}

export interface RequestLog {
  id: string
  request_id: string
  stage: RequestStatus
  action: RequestAction
  actor_id: string | null
  remarks: string | null
  created_at: string
}

export interface SystemSetting {
  key: string
  value: unknown
  updated_by: string | null
  updated_at: string
}

/* ── Joined shapes returned by the server actions ──────────────────────── */

export type ItemWithRefs = Item & {
  category: Pick<Category, "id" | "name"> | null
  unit: Pick<Unit, "id" | "code" | "name"> | null
}

export type OfficeStockRow = OfficeStock & {
  office: Pick<Office, "id" | "name" | "code"> | null
  item: ItemWithRefs | null
  /**
   * Total released for this office+item, summed from the ledger by
   * `getAllOfficeStocks`. Not a column — it cannot be derived from
   * `opening_quantity - quantity`, because a replenishment or an opening
   * balance moves those two independently of anything being issued.
   */
  issued: number
}

export type RequestItemRow = RequestItem & {
  item: ItemWithRefs | null
}

export type RequestReleaseItemRow = RequestReleaseItem & {
  item: ItemWithRefs | null
}

export type RequestReleaseRow = RequestRelease & {
  releaser: Pick<UserProfile, "id" | "full_name"> | null
  acknowledger: Pick<UserProfile, "id" | "full_name"> | null
  resolver: Pick<UserProfile, "id" | "full_name"> | null
  request_release_items?: RequestReleaseItemRow[]
}

/**
 * One printable delivery receipt — a *release*, plus just enough of the slip it
 * came off to identify it on paper.
 *
 * Keyed on the release rather than the request because that is what a receipt
 * is: the paper that travels with one trip to the counter. A request handed
 * over in three batches prints three receipts, each listing only what actually
 * went out that time.
 */
export type DeliveryReceiptData = {
  release: RequestReleaseRow
  request: Pick<
    SupplyRequest,
    "id" | "request_no" | "purpose" | "fiscal_year"
  > & {
    office: Pick<Office, "id" | "name" | "code"> | null
    requester: Pick<UserProfile, "id" | "full_name"> | null
  }
}

export type SupplyRequestRow = SupplyRequest & {
  office: Pick<Office, "id" | "name" | "code"> | null
  requester: Pick<UserProfile, "id" | "full_name" | "email"> | null
  endorser: Pick<UserProfile, "id" | "full_name"> | null
  recommender: Pick<UserProfile, "id" | "full_name"> | null
  reviewer: Pick<UserProfile, "id" | "full_name"> | null
  releaser: Pick<UserProfile, "id" | "full_name"> | null
  request_items?: RequestItemRow[]
  /**
   * Just enough of each release for the list's Receipt column — the detail
   * page fetches the full rows separately. Embedded rather than aggregated
   * because PostgREST cannot roll a child table up to a single status, and a
   * request has a handful of releases at most.
   */
  request_releases?: Pick<RequestRelease, "id" | "ack_status">[]
}

export type StockMovementRow = StockMovement & {
  office: Pick<Office, "id" | "name" | "code"> | null
  item: ItemWithRefs | null
  performer: Pick<UserProfile, "id" | "full_name"> | null
  request: Pick<SupplyRequest, "id" | "request_no"> | null
}

export type RequestLogRow = RequestLog & {
  actor: Pick<UserProfile, "id" | "full_name"> | null
  request?:
    | (Pick<SupplyRequest, "id" | "request_no"> & {
        office: Pick<Office, "id" | "name" | "code"> | null
      })
    | null
}

export type UserProfileRow = UserProfile & {
  /** The primary office. Authorization reads `user_offices`, not this. */
  office: Pick<Office, "id" | "name" | "code"> | null
  user_roles?: { id: string; role_id: string; role: Role | null }[]
  /**
   * Every office this person acts for, primary included — one person can cover
   * several departments with the same roles.
   */
  user_offices?: {
    office_id: string
    office: Pick<Office, "id" | "name" | "code"> | null
  }[]
}

/* ── Action result envelope — actions never throw to the client ────────── */

export type ActionResult<T = null> = { error: string | null; data: T }

/**
 * What an office can still draw of one item, split so the UI can show the
 * right number in the right place:
 *
 * - `balance`    — the allocation row's remaining quantity. This is what
 *                  `release_request` checks, so it is the cap when issuing.
 * - `committed`  — approved but not yet collected on the office's *other*
 *                  open requests.
 * - `available`  — `balance - committed`; what approving can safely promise.
 */
export interface ItemAvailability {
  balance: number
  committed: number
  available: number
}

/**
 * One item an office may actually draw on, as offered by the picker.
 * `available` is `balance - committed`, the ceiling `createRequest` and
 * `approveRequest` enforce; the other two are carried alongside so the UI can
 * explain where the number came from.
 */
export type OfficeItemHit = ItemWithRefs & ItemAvailability
