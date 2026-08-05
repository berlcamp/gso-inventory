import { describe, expect, it } from "vitest"
import {
  canViewRequest,
  requestQueryScope,
  requestVisibility,
  requestVisibilityOrFilter,
} from "./visibility"
import type { RequestStatus } from "@/types/database"

const OWN = "office-own"
const OTHER = "office-other"

/** The role shapes the seeds actually create, by permission not by name. */
const supplyOfficer = requestVisibility({
  officeIds: [OWN],
  canViewAll: false,
  permissions: ["request.create", "request.view", "inventory.view"],
})

const departmentHead = requestVisibility({
  officeIds: [OWN],
  canViewAll: false,
  permissions: ["request.endorse", "request.view", "inventory.view"],
})

/** Supply officer *and* GSO checker on one account — the reported case. */
const checkerAndOfficer = requestVisibility({
  officeIds: [OWN],
  canViewAll: true,
  permissions: [
    "request.create",
    "request.recommend",
    "request.view",
    "request.view_all",
  ],
})

const gsoHead = requestVisibility({
  officeIds: [OWN],
  canViewAll: true,
  permissions: ["request.approve", "request.view", "request.view_all"],
})

const admin = requestVisibility({
  officeIds: [OWN],
  canViewAll: true,
  permissions: ["request.view_all", "request.endorse", "request.approve"],
})

const officeless = requestVisibility({
  officeIds: [],
  canViewAll: true,
  permissions: ["request.view_all", "request.approve"],
})

function req(office_id: string, status: RequestStatus) {
  return { office_id, status }
}

const STAMP = "2026-08-05T04:00:00.000Z"

/** Rejected by GSO — only their decision writes `reviewed_at`. */
function rejectedByGso(office_id: string) {
  return {
    office_id,
    status: "rejected" as RequestStatus,
    endorsed_at: STAMP,
    reviewed_at: STAMP,
  }
}

/** Rejected by the office's own head: `endorsed_at` is stamped, nothing else. */
function rejectedByHead(office_id: string) {
  return {
    office_id,
    status: "rejected" as RequestStatus,
    endorsed_at: STAMP,
    reviewed_at: null,
  }
}

/** Withdrawn after it was endorsed onto GSO's desk. */
function cancelledAtGso(office_id: string) {
  return {
    office_id,
    status: "cancelled" as RequestStatus,
    endorsed_at: STAMP,
    reviewed_at: null,
  }
}

/** Withdrawn by the department before endorsing it. */
function cancelledBeforeEndorsement(office_id: string) {
  return {
    office_id,
    status: "cancelled" as RequestStatus,
    endorsed_at: null,
    reviewed_at: null,
  }
}

const GSO_STAGES: RequestStatus[] = [
  "pending",
  "recommended",
  "approved",
  "partially_released",
  "released",
]

describe("canViewRequest", () => {
  it("shows a scoped user their own office at every stage", () => {
    for (const status of ["awaiting_endorsement", ...GSO_STAGES] as RequestStatus[]) {
      expect(canViewRequest(supplyOfficer, req(OWN, status))).toBe(true)
      expect(canViewRequest(departmentHead, req(OWN, status))).toBe(true)
    }
  })

  it("hides every other office from a scoped user, endorsed or not", () => {
    for (const status of ["awaiting_endorsement", ...GSO_STAGES] as RequestStatus[]) {
      expect(canViewRequest(supplyOfficer, req(OTHER, status))).toBe(false)
      expect(canViewRequest(departmentHead, req(OTHER, status))).toBe(false)
    }
  })

  it("hides another office's unendorsed slip from the GSO side", () => {
    expect(
      canViewRequest(checkerAndOfficer, req(OTHER, "awaiting_endorsement"))
    ).toBe(false)
    expect(canViewRequest(gsoHead, req(OTHER, "awaiting_endorsement"))).toBe(
      false
    )
  })

  it("shows the GSO side every office from `pending` on", () => {
    for (const status of GSO_STAGES) {
      expect(canViewRequest(checkerAndOfficer, req(OTHER, status))).toBe(true)
      expect(canViewRequest(gsoHead, req(OTHER, status))).toBe(true)
    }
  })

  it("still shows the GSO side their own office before endorsement", () => {
    expect(
      canViewRequest(checkerAndOfficer, req(OWN, "awaiting_endorsement"))
    ).toBe(true)
  })

  it("keeps admin's escape hatch: any office, any stage", () => {
    expect(canViewRequest(admin, req(OTHER, "awaiting_endorsement"))).toBe(true)
    expect(canViewRequest(admin, req(OTHER, "released"))).toBe(true)
    expect(canViewRequest(admin, rejectedByHead(OTHER))).toBe(true)
    expect(canViewRequest(admin, cancelledBeforeEndorsement(OTHER))).toBe(true)
  })

  it("hides another office's slip that died before reaching GSO", () => {
    for (const viewer of [checkerAndOfficer, gsoHead]) {
      expect(canViewRequest(viewer, rejectedByHead(OTHER))).toBe(false)
      expect(canViewRequest(viewer, cancelledBeforeEndorsement(OTHER))).toBe(
        false
      )
    }
  })

  it("shows a terminal slip that had reached GSO first", () => {
    for (const viewer of [checkerAndOfficer, gsoHead]) {
      expect(canViewRequest(viewer, rejectedByGso(OTHER))).toBe(true)
      expect(canViewRequest(viewer, cancelledAtGso(OTHER))).toBe(true)
    }
  })

  it("does not read a head's rejection as an arrival at GSO", () => {
    // `endorsed_at` is set by the head's rejection as well as by an
    // endorsement, so it cannot be the stamp that decides a rejected slip.
    expect(rejectedByHead(OTHER).endorsed_at).not.toBeNull()
    expect(canViewRequest(gsoHead, rejectedByHead(OTHER))).toBe(false)
  })

  it("keeps a terminal slip of your own office visible either way", () => {
    expect(canViewRequest(supplyOfficer, rejectedByHead(OWN))).toBe(true)
    expect(
      canViewRequest(checkerAndOfficer, cancelledBeforeEndorsement(OWN))
    ).toBe(true)
  })

  it("hides a terminal slip whose stamps were not selected", () => {
    // Fail closed: a caller that forgot the columns loses rows rather than
    // leaking them.
    expect(canViewRequest(gsoHead, req(OTHER, "rejected"))).toBe(false)
    expect(canViewRequest(gsoHead, req(OTHER, "cancelled"))).toBe(false)
  })

  it("shows a GSO account with no office of its own everything from `pending`", () => {
    expect(canViewRequest(officeless, req(OTHER, "pending"))).toBe(true)
    expect(canViewRequest(officeless, req(OTHER, "awaiting_endorsement"))).toBe(
      false
    )
  })
})

describe("requestQueryScope", () => {
  it("scopes a supply officer to their offices whatever the statuses", () => {
    expect(requestQueryScope(supplyOfficer)).toEqual({
      kind: "offices",
      officeIds: [OWN],
    })
    expect(requestQueryScope(supplyOfficer, ["pending"])).toEqual({
      kind: "offices",
      officeIds: [OWN],
    })
  })

  it("splits an unfiltered GSO read rather than leaving it unfiltered", () => {
    expect(requestQueryScope(checkerAndOfficer)).toEqual({
      kind: "split",
      officeIds: [OWN],
    })
  })

  it("collapses to the office list when the query is pre-GSO only", () => {
    expect(
      requestQueryScope(checkerAndOfficer, ["awaiting_endorsement"])
    ).toEqual({ kind: "offices", officeIds: [OWN] })
  })

  it("collapses to no filter when the query is already past endorsement", () => {
    expect(requestQueryScope(gsoHead, ["pending"])).toEqual({ kind: "all" })
    expect(
      requestQueryScope(gsoHead, ["approved", "partially_released"])
    ).toEqual({ kind: "all" })
  })

  it("splits a mixed status set instead of dropping the office filter", () => {
    expect(
      requestQueryScope(gsoHead, ["awaiting_endorsement", "pending"])
    ).toEqual({ kind: "split", officeIds: [OWN] })
  })

  it("splits a terminal status, whose visibility depends on a stamp", () => {
    expect(requestQueryScope(gsoHead, ["rejected"])).toEqual({
      kind: "split",
      officeIds: [OWN],
    })
    expect(requestQueryScope(gsoHead, ["released", "cancelled"])).toEqual({
      kind: "split",
      officeIds: [OWN],
    })
  })

  it("leaves admin unfiltered at every stage", () => {
    expect(requestQueryScope(admin)).toEqual({ kind: "all" })
    expect(requestQueryScope(admin, ["awaiting_endorsement"])).toEqual({
      kind: "all",
    })
  })
})

describe("requestVisibilityOrFilter", () => {
  // The live stages unconditionally, then one guarded clause per terminal
  // status — each naming the stamp that proves the slip reached GSO.
  const stages =
    "status.in.(pending,recommended,approved,partially_released,released)," +
    "and(status.eq.rejected,reviewed_at.not.is.null)," +
    "and(status.eq.cancelled,endorsed_at.not.is.null)"

  it("ors the viewer's offices against everything that reached GSO", () => {
    expect(requestVisibilityOrFilter([OWN, OTHER])).toBe(
      `office_id.in.(office-own,office-other),${stages}`
    )
  })

  it("never names the pre-GSO stage", () => {
    expect(requestVisibilityOrFilter([OWN])).not.toContain(
      "awaiting_endorsement"
    )
  })

  it("never lets a terminal status through unguarded", () => {
    const filter = requestVisibilityOrFilter([OWN])
    for (const status of ["rejected", "cancelled"]) {
      expect(filter).not.toContain(`status.in.(${status}`)
      expect(filter).toContain(`and(status.eq.${status},`)
    }
  })

  it("drops the office clause when there are no offices to name", () => {
    expect(requestVisibilityOrFilter([])).toBe(stages)
  })
})
