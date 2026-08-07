"use client"

/**
 * The sheet GSO walks the warehouse with.
 *
 * **Keyed on the request, not on a release** — the opposite of the delivery
 * receipt, and for the same underlying reason. A receipt is the paper record of
 * one trip that has already happened; a checklist is the instruction for a trip
 * nobody has made yet, so there is no release to key it on. It is printed once
 * the office's own head has endorsed the slip, which is the moment GSO first
 * has any business with it.
 *
 * One blank column, one signatory. Nothing on this sheet is a two-party record:
 * it is GSO staff checking GSO's own shelves before anything is handed over, so
 * "Checked By" is the whole of it. The two wet signatures come later, on the
 * delivery receipt.
 */

import { format } from "date-fns"
import {
  MetaRow,
  PrintSheet,
  SignatureBlock,
  Td,
  Th,
  qty,
} from "@/components/print/sheet"
import type { RequestItemRow, RequestStatus, SupplyRequestRow } from "@/types/database"

/**
 * The quantity that is actually operative right now, and what to call it.
 *
 * Every stage after filing writes its own column and each is a ceiling read off
 * the one below it, so "how many should I pull off the shelf" has a different
 * answer at `pending` than at `approved`. Printing `quantity_requested`
 * throughout would send a picker after stock the checker already cut.
 *
 * Read off the request's status rather than off whichever column happens to be
 * non-null, so every line on one sheet is labelled with the same stage — a
 * checklist whose rows silently came from different desks is worse than one
 * that is merely out of date.
 */
const STAGE_LABEL: Partial<Record<RequestStatus, string>> = {
  pending: "as endorsed by the department head",
  recommended: "as recommended by the GSO checker",
  approved: "as approved by the GSO head",
  partially_released: "as approved by the GSO head",
  released: "as approved by the GSO head",
}

function operativeQuantity(line: RequestItemRow): number {
  return Number(
    line.quantity_approved ??
      line.quantity_recommended ??
      line.quantity_endorsed ??
      line.quantity_requested
  )
}

export function ItemsChecklist({ request }: { request: SupplyRequestRow }) {
  const lines = request.request_items ?? []
  const stage = STAGE_LABEL[request.status] ?? "as filed"

  return (
    <PrintSheet title="Items Checklist">
      {/* ── Meta ───────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-6 text-[11px]">
        <dl className="space-y-1">
          {/* The date the sheet was printed, not the date anything happened —
              a checklist is a working document and its usefulness is entirely
              about when someone took it into the stockroom. */}
          <MetaRow label="Date" value={format(new Date(), "dd MMMM yyyy")} />
          <MetaRow
            label="Office"
            value={
              request.office
                ? `${request.office.name} (${request.office.code})`
                : "—"
            }
          />
        </dl>
        <dl className="space-y-1">
          <MetaRow label="RIS No." value={request.request_no} />
          <MetaRow label="Fiscal Year" value={String(request.fiscal_year)} />
        </dl>
      </div>

      {request.purpose && (
        <p className="mt-2.5 text-[11px]">
          <span className="font-semibold">Purpose:</span> {request.purpose}
        </p>
      )}

      {/* ── Items ──────────────────────────────────────────────────── */}
      <table className="mt-4 w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <Th className="w-10 text-center">No.</Th>
            <Th>Item Description</Th>
            <Th className="w-20 text-center">Unit</Th>
            <Th className="w-24 text-right">Quantity</Th>
            {/* Left blank on purpose: this is the column the sheet exists for.
                A pre-filled count is the picker agreeing with the system
                before they have looked at the shelf. */}
            <Th className="w-28 text-center">Qty. Checked</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.id}>
              <Td className="text-center">{index + 1}</Td>
              <Td>{line.item?.name ?? "—"}</Td>
              <Td className="text-center">{line.item?.unit?.code ?? "—"}</Td>
              <Td className="text-right tabular-nums">
                {qty(operativeQuantity(line))}
              </Td>
              <Td />
            </tr>
          ))}
          {/* Blank rows so the table reads as a closed form rather than a list
              that trails off, and so nothing can be added under the last line
              after it has been signed. */}
          {Array.from({ length: Math.max(0, 5 - lines.length) }).map((_, i) => (
            <tr key={`blank-${i}`}>
              <Td>&nbsp;</Td>
              <Td />
              <Td />
              <Td />
              <Td />
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[10px] text-neutral-600">
        Quantities are {stage}. This checklist is for verifying stock on hand —
        it is not a receipt and transfers nothing.
      </p>

      {request.remarks && (
        <p className="mt-2.5 text-[11px]">
          <span className="font-semibold">Remarks:</span> {request.remarks}
        </p>
      )}

      {/* ── Signature ──────────────────────────────────────────────── */}
      {/* Two columns with one child, so the block sits at the same width and
          on the same baseline as the receipt's pair. A rule spanning the whole
          page reads as a footer rather than as somewhere to sign. */}
      <div className="receipt-signatures mt-12 grid grid-cols-2 gap-12 text-[11px]">
        <SignatureBlock label="Checked By" />
      </div>
    </PrintSheet>
  )
}
