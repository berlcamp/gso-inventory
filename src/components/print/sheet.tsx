"use client"

/**
 * The shared anatomy of every sheet of paper this app produces.
 *
 * There are two — the delivery receipt that travels with the goods, and the
 * items checklist GSO walks the warehouse with — and they are the same
 * document above the table: the same four seals, the same letterhead, the same
 * A4 page rules, the same bordered table cells, the same blank-above-a-rule
 * signature block. Only the title, the columns and the signatories differ.
 *
 * Keeping that in one place is not just deduplication. These are LGU forms:
 * if the receipt's letterhead and the checklist's ever drifted apart, the two
 * would stop reading as documents from the same office, and nobody would
 * notice until a stack of them was already signed.
 */

import { useEffect, useRef } from "react"
import Image from "next/image"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Shared quantity formatter — no trailing `.00` on whole units. */
export const qty = (value: number) =>
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
 * `globals.css` — this way the A4 sheet and its margins exist only on the
 * routes that are actually sheets of paper, instead of reformatting every
 * Ctrl-P in the app.
 *
 * `print-color-adjust: exact` is what keeps the table rules and the header
 * divider from vanishing: browsers drop backgrounds and lighten borders when
 * printing unless told otherwise, and a form with no lines on it is not a form.
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

/**
 * Opens the print dialog once the sheet has settled.
 *
 * Fired once — StrictMode double-invokes effects in development, and two
 * stacked print dialogs is a real thing that happens.
 */
function useAutoPrint() {
  const printed = useRef(false)

  useEffect(() => {
    if (printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 400)
    return () => window.clearTimeout(timer)
  }, [])
}

/**
 * A blank A4 sheet with the GSO letterhead and a title, ready for a form.
 *
 * Everything a caller supplies goes below the title rule. `autoPrint` is on by
 * default because both routes are opened in their own tab from a button whose
 * only purpose is to print.
 */
export function PrintSheet({
  title,
  autoPrint = true,
  children,
}: {
  title: string
  autoPrint?: boolean
  children: React.ReactNode
}) {
  return (
    <>
      <style>{PRINT_CSS}</style>
      {autoPrint && <AutoPrint />}

      <div className="min-h-screen bg-muted/40 py-8 print:bg-white print:py-0">
        <div className="receipt-noprint mx-auto mb-4 flex max-w-[210mm] items-center justify-end gap-2 px-4">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
        </div>

        <div className="receipt-sheet mx-auto max-w-[210mm] bg-white px-10 py-8 text-black shadow-sm print:shadow-none">
          {/* The two logo groups are `flex-1` from a zero basis so they take
              equal width whatever the seals measure — that is what puts the
              title on the *page's* centre line rather than in the middle of
              whatever gap the logos happen to leave. */}
          <header className="flex items-center gap-4">
            <div className="flex flex-1 items-center justify-start gap-3">
              {LOGOS_LEFT.map((logo) => (
                <Seal key={logo.src} {...logo} />
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
                <Seal key={logo.src} {...logo} />
              ))}
            </div>
          </header>

          <div className="mt-4 border-t-2 border-black" />

          <h1 className="mt-4 text-center text-[16px] font-bold uppercase tracking-[0.2em]">
            {title}
          </h1>

          {children}
        </div>
      </div>
    </>
  )
}

/** Split out so the hook is not called conditionally on `autoPrint`. */
function AutoPrint() {
  useAutoPrint()
  return null
}

function Seal({
  src,
  width,
  height,
  size,
}: {
  src: string
  width: number
  height: number
  size: string
}) {
  return (
    <Image
      src={src}
      width={width}
      height={height}
      // Decorative: the header text beside them already names the republic,
      // the office, and the city.
      alt=""
      unoptimized
      priority
      className={`${size} w-auto object-contain`}
    />
  )
}

export function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-semibold">{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function Th({
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

export function Td({
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

/**
 * Blank space, a rule, then the role.
 *
 * **Nothing is pre-filled**, on either form. The whole point of the sheet is
 * the wet signature it collects; a pre-printed name is a claim the paper makes
 * before anyone agreed to it, and the app already holds the digital half
 * (`released_by`, `acknowledge_release`) where it cannot be typed over.
 */
export function SignatureBlock({ label }: { label: string }) {
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
