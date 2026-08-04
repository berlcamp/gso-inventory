import { describe, expect, it } from "vitest"
import {
  releaseAckEligibility,
  rollUpReceipt,
  type ReceiptViewer,
} from "./receipt"
import type { ReleaseAckStatus } from "@/types/database"

const releases = (...statuses: ReleaseAckStatus[]) =>
  statuses.map((ack_status) => ({ ack_status }))

describe("rollUpReceipt", () => {
  it("reports nothing to sign for when no stock has gone out", () => {
    expect(rollUpReceipt([])).toBe("none")
    expect(rollUpReceipt(null)).toBe("none")
    expect(rollUpReceipt(undefined)).toBe("none")
  })

  it("passes a single release through unchanged", () => {
    expect(rollUpReceipt(releases("pending"))).toBe("pending")
    expect(rollUpReceipt(releases("confirmed"))).toBe("confirmed")
    expect(rollUpReceipt(releases("disputed"))).toBe("disputed")
    expect(rollUpReceipt(releases("waived"))).toBe("waived")
  })

  it("lets one discrepancy outrank any number of clean releases", () => {
    expect(
      rollUpReceipt(releases("confirmed", "confirmed", "disputed", "confirmed"))
    ).toBe("disputed")
  })

  it("ranks an unsigned release above a settled one", () => {
    expect(rollUpReceipt(releases("confirmed", "pending"))).toBe("pending")
  })

  it("ranks a discrepancy above an unsigned release", () => {
    expect(rollUpReceipt(releases("pending", "disputed"))).toBe("disputed")
  })

  // A slip released once before this feature and once after must not read as
  // unsignable — the confirmation that does exist is the more useful fact.
  it("does not let a pre-feature release mask a real confirmation", () => {
    expect(rollUpReceipt(releases("waived", "confirmed"))).toBe("confirmed")
  })

  it("stays waived when every release predates confirmation", () => {
    expect(rollUpReceipt(releases("waived", "waived"))).toBe("waived")
  })
})

describe("releaseAckEligibility", () => {
  const OFFICE = "office-1"
  const viewer: ReceiptViewer = {
    userId: "user-1",
    officeIds: [OFFICE],
    canAcknowledge: true,
  }

  it("lets the receiving office sign for a pending release", () => {
    const result = releaseAckEligibility(
      { ack_status: "pending", released_by: "custodian-9" },
      OFFICE,
      viewer
    )
    expect(result).toEqual({ canAcknowledge: true, reason: null })
  })

  // The two-man rule, and the reason the feature is worth having.
  it("refuses the person who recorded the release", () => {
    const result = releaseAckEligibility(
      { ack_status: "pending", released_by: viewer.userId },
      OFFICE,
      viewer
    )
    expect(result.canAcknowledge).toBe(false)
    expect(result.reason).toMatch(/someone else/i)
  })

  it("refuses another office", () => {
    const result = releaseAckEligibility(
      { ack_status: "pending", released_by: "custodian-9" },
      "office-2",
      viewer
    )
    expect(result.canAcknowledge).toBe(false)
    expect(result.reason).toMatch(/office that received/i)
  })

  it("refuses a viewer without the permission", () => {
    const result = releaseAckEligibility(
      { ack_status: "pending", released_by: "custodian-9" },
      OFFICE,
      { ...viewer, canAcknowledge: false }
    )
    expect(result.canAcknowledge).toBe(false)
    expect(result.reason).toMatch(/supply officer or department head/i)
  })

  it("refuses a viewer with no office at all", () => {
    const result = releaseAckEligibility(
      { ack_status: "pending", released_by: "custodian-9" },
      OFFICE,
      { ...viewer, officeIds: [] }
    )
    expect(result.canAcknowledge).toBe(false)
  })

  // One person can cover several departments, so a release to their *second*
  // office is as much theirs to sign for as one to their primary.
  it("lets someone sign for any office they cover, not just the first", () => {
    const result = releaseAckEligibility(
      { ack_status: "pending", released_by: "custodian-9" },
      "office-3",
      { ...viewer, officeIds: ["office-1", "office-3"] }
    )
    expect(result).toEqual({ canAcknowledge: true, reason: null })
  })

  // The two-man rule has to survive the widening: covering the office is not
  // enough if you are the one who handed the goods over.
  it("still refuses the releaser in a multi-office assignment", () => {
    const result = releaseAckEligibility(
      { ack_status: "pending", released_by: viewer.userId },
      "office-3",
      { ...viewer, officeIds: ["office-1", "office-3"] }
    )
    expect(result.canAcknowledge).toBe(false)
    expect(result.reason).toMatch(/someone else/i)
  })

  // Already resolved: nothing to do, and no explanation to give — the card
  // shows who signed and when instead.
  it("gives no reason for a release that is already settled", () => {
    for (const ack_status of ["confirmed", "disputed", "waived"] as const) {
      expect(
        releaseAckEligibility({ ack_status, released_by: "x" }, OFFICE, viewer)
      ).toEqual({ canAcknowledge: false, reason: null })
    }
  })
})
