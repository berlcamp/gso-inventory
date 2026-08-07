"use client"

/**
 * The paper that travels with the goods.
 *
 * One sheet per *release*, not per request: a slip handed over in two trips
 * prints two receipts, each listing only what physically went out that time.
 * Printing the whole request would put quantities on the page that nobody in
 * the room can point at.
 *
 * The letterhead, the page rules, the table cells and the signature blocks all
 * come from `@/components/print/sheet`, shared with the items checklist — see
 * the note there on why these two forms must not drift apart.
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
import type { DeliveryReceiptData } from "@/types/database"

export function DeliveryReceipt({ data }: { data: DeliveryReceiptData }) {
  const { release, request } = data
  const lines = release.request_release_items ?? []

  const releasedAt = new Date(release.released_at)
  const anyVoided = lines.some((line) => Number(line.quantity_voided ?? 0) > 0)

  return (
    <PrintSheet title="Delivery Receipt">
      {/* ── Meta ───────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-6 text-[11px]">
        <dl className="space-y-1">
          <MetaRow label="Date" value={format(releasedAt, "dd MMMM yyyy")} />
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
            <Th className="w-24 text-center">Unit</Th>
            <Th className="w-32 text-right">Quantity Delivered</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            // The sheet says "Quantity Delivered" above two signature blocks,
            // so it must print what was actually handed over — net of anything
            // GSO has since established never left the warehouse. A reprint
            // carrying the original figure would be asking two people to sign
            // for goods the system already knows were not issued.
            const voided = Number(line.quantity_voided ?? 0)
            const delivered = Number(line.quantity_issued) - voided

            return (
              <tr key={line.id}>
                <Td className="text-center">{index + 1}</Td>
                <Td>
                  {line.item?.name ?? "—"}
                  {voided > 0 && (
                    <span className="ml-1 font-semibold uppercase tracking-wide">
                      — {qty(voided)} voided
                    </span>
                  )}
                </Td>
                <Td className="text-center">{line.item?.unit?.code ?? "—"}</Td>
                <Td className="text-right tabular-nums">{qty(delivered)}</Td>
              </tr>
            )
          })}
          {/* Blank rows so the table reads as a closed form rather than a list
              that trails off — and so nothing can be written under the last
              line after both parties have signed. */}
          {Array.from({ length: Math.max(0, 5 - lines.length) }).map((_, i) => (
            <tr key={`blank-${i}`}>
              <Td>&nbsp;</Td>
              <Td />
              <Td />
              <Td />
            </tr>
          ))}
        </tbody>
      </table>

      {anyVoided && (
        <p className="mt-2.5 border border-black px-2 py-1 text-[10px]">
          <span className="font-semibold uppercase">Notice:</span> One or more
          lines on this release were voided by the General Services Office —
          recorded as issued but not physically released. The quantities above
          are net of those voids and the balance has been restored. See the
          request&rsquo;s stock ledger for the correction.
        </p>
      )}

      {release.remarks && (
        <p className="mt-2.5 text-[11px]">
          <span className="font-semibold">Remarks:</span> {release.remarks}
        </p>
      )}

      {/* ── Signatures ─────────────────────────────────────────────── */}
      <div className="receipt-signatures mt-12 grid grid-cols-2 gap-12 text-[11px]">
        <SignatureBlock label="Released By" />
        <SignatureBlock label="Received By" />
      </div>
    </PrintSheet>
  )
}
