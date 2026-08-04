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

export const userSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid Google email."),
  full_name: z.string().trim().min(2, "Full name is required.").max(150),
  position: z.string().trim().max(100).optional().nullable(),
  office_id: z.string().uuid("Assign an office.").nullable(),
  role_ids: z.array(z.string().uuid()).default([]),
})

export type SupplyRequestFormValues = z.infer<typeof supplyRequestSchema>
export type AcknowledgeReleaseValues = z.infer<typeof acknowledgeReleaseSchema>
export type OfficeFormValues = z.infer<typeof officeSchema>
export type ItemFormValues = z.infer<typeof itemSchema>
export type AdjustStockFormValues = z.infer<typeof adjustStockSchema>
export type UserFormValues = z.infer<typeof userSchema>
