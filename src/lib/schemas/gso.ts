import { z } from "zod"

export const requestLineSchema = z.object({
  item_id: z.string().uuid("Pick an item."),
  quantity: z.coerce
    .number()
    .positive("Quantity must be greater than zero.")
    .max(1_000_000, "Quantity looks too large."),
  remarks: z.string().max(300).optional().nullable(),
})

export const supplyRequestSchema = z.object({
  office_id: z.string().uuid("Select the requesting office."),
  purpose: z
    .string()
    .trim()
    .min(3, "Describe what the supplies are for.")
    .max(500),
  remarks: z.string().trim().max(500).optional().nullable(),
  lines: z
    .array(requestLineSchema)
    .min(1, "Add at least one item to the request."),
})

/**
 * Editing a slip that has not been endorsed yet — same shape minus the office.
 *
 * The office is deliberately not editable. Every allocation check, the fiscal
 * year on the row, and the set of heads who may endorse all hang off it, so
 * moving a slip between offices is filing a different request, not editing this
 * one. `.omit()` works here only because `supplyRequestSchema` carries no
 * refinements — see `userUpdateSchema` for the case where it does not.
 */
export const requestUpdateSchema = supplyRequestSchema.omit({
  office_id: true,
})

/**
 * The requesting office's counter-signature on one release.
 *
 * `lines` is optional: omitting it means "everything arrived exactly as
 * issued", which is what a plain confirmation sends. A discrepancy sends every
 * line, so the RPC can tell an unanswered line from one answered with zero.
 */
export const acknowledgeReleaseSchema = z
  .object({
    release_id: z.string().uuid(),
    dispute: z.boolean().default(false),
    remarks: z.string().trim().max(500).optional().nullable(),
    lines: z
      .array(
        z.object({
          release_item_id: z.string().uuid(),
          quantity_received: z.coerce
            .number()
            .min(0, "Received quantity cannot be negative.")
            .max(1_000_000, "Quantity looks too large."),
        })
      )
      .optional(),
  })
  .refine((v) => !v.dispute || (v.remarks ?? "").trim().length > 0, {
    message: "Describe the discrepancy before reporting it.",
    path: ["remarks"],
  })
  .refine((v) => !v.dispute || (v.lines?.length ?? 0) > 0, {
    message: "Record what actually arrived for each item.",
    path: ["lines"],
  })

/**
 * Taking back a released line the warehouse never actually handed over.
 *
 * The reason is required and has no "optional remarks" fallback, unlike every
 * other remark field here. A void is the one movement whose justification is
 * the whole point of it: without one it is indistinguishable from the bare
 * stock adjustment it exists to replace, and the ledger row it writes is what
 * an auditor reads years later. The RPC refuses a blank one too — this only
 * saves the round trip.
 */
export const voidReleaseItemSchema = z.object({
  release_item_id: z.string().uuid(),
  quantity: z.coerce
    .number()
    .positive("Void quantity must be greater than zero.")
    .max(1_000_000, "Quantity looks too large."),
  reason: z
    .string()
    .trim()
    .min(5, "Record why this line is being voided.")
    .max(500),
})

export const officeSchema = z.object({
  name: z.string().trim().min(3, "Office name is required.").max(200),
  code: z
    .string()
    .trim()
    .min(2, "Code is required.")
    .max(20)
    .regex(/^[A-Za-z0-9\-_.]+$/, "Use letters, numbers, and dashes only."),
  head_name: z.string().trim().max(150).optional().nullable(),
  contact_number: z.string().trim().max(50).optional().nullable(),
  is_active: z.boolean().default(true),
})

export const itemSchema = z.object({
  name: z.string().trim().min(2, "Item name is required.").max(250),
  category_id: z.string().uuid("Select a category."),
  unit_id: z.string().uuid("Select a unit."),
  description: z.string().trim().max(500).optional().nullable(),
  reorder_level: z.coerce.number().min(0).default(0),
  is_active: z.boolean().default(true),
})

export const adjustStockSchema = z.object({
  office_id: z.string().uuid("Select an office."),
  item_id: z.string().uuid("Select an item."),
  // "opening" sets the fiscal-year baseline (moves opening_quantity alongside
  // the balance) — the only way to give an item added after the spreadsheet
  // load a baseline. The enum has always had it; it was just unreachable.
  movement_type: z.enum(["opening", "replenishment", "return", "adjustment"]),
  quantity: z.coerce
    .number()
    .refine((v) => v !== 0, "Quantity cannot be zero.")
    .refine((v) => Math.abs(v) <= 1_000_000, "Quantity looks too large."),
  remarks: z.string().trim().max(300).optional().nullable(),
})

/**
 * The fields, unrefined. `.omit()` refuses to run on an object that already
 * carries refinements, and editing a user is exactly that call — the email is
 * the auth identity and is not editable — so the check below is attached to
 * each exported schema rather than baked into the shared shape.
 */
const userFieldsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid Google email."),
  full_name: z.string().trim().min(2, "Full name is required.").max(150),
  position: z.string().trim().max(100).optional().nullable(),
  /** The primary office — shown in the topbar, and the default when filing. */
  office_id: z.string().uuid("Assign an office.").nullable(),
  /**
   * Every office this person acts for, primary included. One person can cover
   * several departments with the same roles; the action normalizes the
   * primary into this set so the two can never disagree.
   */
  office_ids: z.array(z.string().uuid()).default([]),
  role_ids: z.array(z.string().uuid()).default([]),
})

/** Additional offices hang off the primary, so a set without one is nonsense. */
const hasPrimaryOffice = (v: {
  office_id: string | null
  office_ids: string[]
}) => v.office_id !== null || v.office_ids.length === 0

const primaryOfficeIssue = {
  message: "Pick a primary office before assigning additional ones.",
  path: ["office_id"],
}

export const userSchema = userFieldsSchema.refine(
  hasPrimaryOffice,
  primaryOfficeIssue
)

/** Editing a user: same shape minus the email, which is the auth identity. */
export const userUpdateSchema = userFieldsSchema
  .omit({ email: true })
  .refine(hasPrimaryOffice, primaryOfficeIssue)

export type SupplyRequestFormValues = z.infer<typeof supplyRequestSchema>
export type RequestUpdateValues = z.infer<typeof requestUpdateSchema>
export type AcknowledgeReleaseValues = z.infer<typeof acknowledgeReleaseSchema>
export type VoidReleaseItemValues = z.infer<typeof voidReleaseItemSchema>
export type OfficeFormValues = z.infer<typeof officeSchema>
export type ItemFormValues = z.infer<typeof itemSchema>
export type AdjustStockFormValues = z.infer<typeof adjustStockSchema>
export type UserFormValues = z.infer<typeof userSchema>
export type UserUpdateValues = z.infer<typeof userUpdateSchema>
