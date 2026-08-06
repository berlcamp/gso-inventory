"use client"

/**
 * The paper that travels with the goods.
 *
 * One sheet per *release*, not per request: a slip handed over in two trips
 * prints two receipts, each listing only what physically went out that time.
 * Printing the whole request would put quantities on the page that nobody in
 * the room can point at.
 *
 * Both signature blocks are left **blank above a rule** on purpose. The whole
 * point of the sheet is the two wet signatures it collects at the counter — a
 * pre-printed name is a claim the paper makes before anyone has agreed to it,
 * and the app already records the digital half (`released_by`, and the
 * receiving office's own acknowledgement) where it cannot be typed over.
 */

import { useEffect, useRef } from "react"
import Image from "next/image"
import { format } from "date-fns"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DeliveryReceiptData } from "@/types/database"

const qty = (value: number) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })

/**
 * The seal row. Sized by height so four logos of four different aspect ratios
 * sit on one optical line; the intrinsic dimensions are the real pixel sizes of
 * the files, which is what keeps `next/image` from distorting them.
 *
 * `unoptimized` because these are four small PNGs that must be on the page
 * before the print dialog opens — going through the image optimizer adds a
 * round trip on exactly the render that cannot wait for one.
 */
const LOGOS_LEFT = [
  { src: "/logo1.png", width: 692, height: 648, size: "h-16" },
  { src: "/logo2.png", width: 166, height: 166, size: "h-16" },
]
const LOGOS_RIGHT = [
  { src: "/logo3.png", width: 135, height: 137, size: "h-16" },
  // A wordmark, not a seal: matched on optical weight rather than on height,
  // since 2.5× as wide as it is tall would otherwise swallow the header.
  { src: "/logo4.png", width: 180, height: 72, size: "h-11" },
]

/**
 * `@page` is a document-level rule, so it lives here rather than in
 * `globals.css` — this way the A4 sheet and its margins exist only on the route
 * that is actually a sheet of paper, instead of reformatting every Ctrl-P in
 * the app.
 *
 * `print-color-adjust: exact` is what keeps the table rules and the header
 * divider from vanishing: browsers drop backgrounds and lighten borders when
 * printing unless told otherwise, and a receipt with no lines on it is not a
 * receipt.
 */
const PRINT_CSS = `
@page { size: A4 portrait; margin: 14mm 12mm; }

@media print {
  html, body {
    background: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt-noprint { display: none !important; }
  .receipt-sheet {
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    box-shadow: none !important;
    max-width: none !important;
    width: auto !important;
  }
  /* A line item must not be split across two sheets — half a quantity on the
     next page is worse than a shorter first page. */
  tr, .receipt-signatures { break-inside: avoid; }
  thead { display: table-header-group; }
}
`

export function DeliveryReceipt({ data }: { data: DeliveryReceiptData }) {
  const { release, request } = data
  const lines = release.request_release_items ?? []
  const printed = useRef(false)

  // Opened in its own tab from the request page, so the print dialog is the
  // only reason anyone is here. Fired once — StrictMode double-invokes effects
  // in development, and two stacked print dialogs is a real thing that happens.
  useEffect(() => {
    if (printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 400)
    return () => window.clearTimeout(timer)
  }, [])

  const releasedAt = new Date(release.released_at)

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="min-h-screen bg-muted/40 py-8 print:bg-white print:py-0">
        <div className="receipt-noprint mx-auto mb-4 flex max-w-[210mm] items-center justify-end gap-2 px-4">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
        </div>

        <div className="receipt-sheet mx-auto max-w-[210mm] bg-white px-10 py-8 text-black shadow-sm print:shadow-none">
          {/* ── Header ───────────────────────────────────────────────── */}
          {/* The two logo groups are `flex-1` from a zero basis so they take
              equal width whatever the seals measure — that is what puts the
              title on the *page's* centre line rather than in the middle of
              whatever gap the logos happen to leave. */}
          <header className="flex items-center gap-4">
            <div className="flex flex-1 items-center justify-start gap-3">
              {LOGOS_LEFT.map((logo) => (
                <Image
                  key={logo.src}
                  src={logo.src}
                  width={logo.width}
                  height={logo.height}
                  // Decorative: the header text beside them already names the
                  // republic, the office, and the city.
                  alt=""
                  unoptimized
                  priority
                  className={`${logo.size} w-auto object-contain`}
                />
              ))}
            </div>

            <div className="shrink-0 text-center leading-tight">
              <p className="text-[11px] tracking-wide">
                Republic of the Philippines
              </p>
              <p className="text-[13px] font-bold uppercase tracking-wide">
                General Services Office
              </p>
              <p className="text-[11px] tracking-wide">City of Ozamiz</p>
            </div>

            <div className="flex flex-1 items-center justify-end gap-3">
              {LOGOS_RIGHT.map((logo) => (
                <Image
                  key={logo.src}
                  src={logo.src}
                  width={logo.width}
                  height={logo.height}
                  // Decorative: the header text beside them already names the
                  // republic, the office, and the city.
                  alt=""
                  unoptimized
                  priority
                  className={`${logo.size} w-auto object-contain`}
                />
              ))}
            </div>
          </header>

          <div className="mt-4 border-t-2 border-black" />

          <h1 className="mt-4 text-center text-[16px] font-bold uppercase tracking-[0.2em]">
            Delivery Receipt
          </h1>

          {/* ── Meta ─────────────────────────────────────────────────── */}
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

          {/* ── Items ────────────────────────────────────────────────── */}
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
              {lines.map((line, index) => (
                <tr key={line.id}>
                  <Td className="text-center">{index + 1}</Td>
                  <Td>{line.item?.name ?? "—"}</Td>
                  <Td className="text-center">{line.item?.unit?.code ?? "—"}</Td>
                  <Td className="text-right tabular-nums">
                    {qty(line.quantity_issued)}
                  </Td>
                </tr>
              ))}
              {/* Blank rows so the table reads as a closed form rather than a
                  list that trails off — and so nothing can be written under the
                  last line after both parties have signed. */}
              {Array.from({ length: Math.max(0, 5 - lines.length) }).map(
                (_, i) => (
                  <tr key={`blank-${i}`}>
                    <Td>&nbsp;</Td>
                    <Td />
                    <Td />
                    <Td />
                  </tr>
                )
              )}
            </tbody>
          </table>

          {release.remarks && (
            <p className="mt-2.5 text-[11px]">
              <span className="font-semibold">Remarks:</span> {release.remarks}
            </p>
          )}

          {/* ── Signatures ───────────────────────────────────────────── */}
          <div className="receipt-signatures mt-12 grid grid-cols-2 gap-12 text-[11px]">
            <SignatureBlock label="Released By" />
            <SignatureBlock label="Received By" />
          </div>
        </div>
      </div>
    </>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-semibold">{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={`border border-black px-1.5 py-1 text-left text-[10px] font-bold uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  className = "",
}: {
  children?: React.ReactNode
  className?: string
}) {
  return (
    <td className={`border border-black px-1.5 py-1 align-top ${className}`}>
      {children}
    </td>
  )
}

/** Blank space, a rule, then the role. Nothing pre-filled — see the file note. */
function SignatureBlock({ label }: { label: string }) {
  return (
    <div className="text-center">
      {/* Room for an actual hand — a rule with nothing above it gets signed
          across the label instead. */}
      <div className="h-16" />
      <div className="border-t border-black" />
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide">
        {label}
      </p>
      <p className="text-[9px] text-neutral-600">Signature over printed name</p>
    </div>
  )
}
