/**
 * Hand-maintained TypeScript types for the `gso_inventory` Postgres schema.
 *
 * Regenerate with:
 *   npx supabase gen types typescript --project-id <id> --schema gso_inventory > src/types/database.ts
 */

export const SCHEMA = "gso_inventory" as const

/* ── Enums ─────────────────────────────────────────────────────────────── */

export type RequestStatus =
  | "pending"
  | "approved"
  | "partially_released"
  | "released"
  | "rejected"
  | "cancelled"

export type RequestSource = "system" | "walk_in"

export type MovementType =
  | "opening"
  | "release"
  | "replenishment"
  | "return"
  | "adjustment"

export type RequestAction =
  | "submitted"
  | "approved"
  | "rejected"
  | "released"
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

export interface UserProfile {
  id: string
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
  quantity_approved: number | null
  quantity_released: number
  remarks: string | null
  created_at: string
}

export interface StockMovement {
  id: string
  office_id: string
  item_id: string
  movement_type: MovementType
  quantity: number
  balance_after: number
  request_id: string | null
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
}

export type RequestItemRow = RequestItem & {
  item: ItemWithRefs | null
}

export type SupplyRequestRow = SupplyRequest & {
  office: Pick<Office, "id" | "name" | "code"> | null
  requester: Pick<UserProfile, "id" | "full_name" | "email"> | null
  reviewer: Pick<UserProfile, "id" | "full_name"> | null
  releaser: Pick<UserProfile, "id" | "full_name"> | null
  request_items?: RequestItemRow[]
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
  office: Pick<Office, "id" | "name" | "code"> | null
  user_roles?: { id: string; role_id: string; role: Role | null }[]
}

/* ── Action result envelope — actions never throw to the client ────────── */

export type ActionResult<T = null> = { error: string | null; data: T }
