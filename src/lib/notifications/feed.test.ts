import { describe, expect, it } from "vitest"
import {
  buildFeed,
  type NotificationRequestRow,
  type NotificationSource,
} from "./feed"

let seq = 0

function row(
  overrides: Partial<NotificationRequestRow> = {}
): NotificationRequestRow {
  seq += 1
  return {
    id: `req-${seq}`,
    request_no: `RS-2026-${String(seq).padStart(4, "0")}`,
    status: "pending",
    requested_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    office: { code: "ACCTG", name: "City Accounting Office" },
    requester: { full_name: "Juan Dela Cruz" },
    ...overrides,
  }
}

function source(
  kind: NotificationSource["kind"],
  rows: NotificationRequestRow[],
  total?: number
): NotificationSource {
  return { kind, rows, total: total ?? rows.length }
}

describe("buildFeed", () => {
  it("returns an empty feed when no bucket was fetched", () => {
    expect(buildFeed([])).toEqual({
      actionable: [],
      recent: [],
      count: 0,
      truncated: false,
    })
  })

  it("orders actionable kinds endorse → check → review → release → pickup", () => {
    const feed = buildFeed([
      source("pickup", [row({ id: "e", status: "approved" })]),
      source("release", [row({ id: "d", status: "approved" })]),
      source("endorse", [row({ id: "a", status: "awaiting_endorsement" })]),
      source("review", [row({ id: "c", status: "recommended" })]),
      source("check", [row({ id: "b", status: "pending" })]),
    ])

    expect(feed.actionable.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"])
    expect(feed.count).toBe(5)
    expect(feed.truncated).toBe(false)
  })

  it("puts the longest-waiting request first within a kind", () => {
    const feed = buildFeed([
      source("review", [
        row({ id: "new", updated_at: "2026-08-03T00:00:00.000Z" }),
        row({ id: "old", updated_at: "2026-07-28T00:00:00.000Z" }),
        row({ id: "mid", updated_at: "2026-08-01T00:00:00.000Z" }),
      ]),
    ])

    expect(feed.actionable.map((i) => i.id)).toEqual(["old", "mid", "new"])
  })

  it("sorts undated rows last rather than to the top", () => {
    const feed = buildFeed([
      source("review", [
        row({ id: "undated", requested_at: null, updated_at: null }),
        row({ id: "dated", updated_at: "2026-08-03T00:00:00.000Z" }),
      ]),
    ])

    expect(feed.actionable.map((i) => i.id)).toEqual(["dated", "undated"])
    expect(feed.actionable[1].at).toBeNull()
  })

  it("badges the exact total, not the number of rows fetched", () => {
    const rows = Array.from({ length: 20 }, () => row())
    const feed = buildFeed([source("review", rows, 34)])

    expect(feed.actionable).toHaveLength(20)
    expect(feed.count).toBe(34)
    expect(feed.truncated).toBe(true)
  })

  it("keeps a request in one bucket only, under the higher-priority verb", () => {
    const shared = row({ id: "shared", status: "approved" })
    const feed = buildFeed([
      source("release", [shared]),
      source("pickup", [shared]),
    ])

    expect(feed.actionable).toHaveLength(1)
    expect(feed.actionable[0].kind).toBe("release")
    // …and the duplicate must not be counted twice, or the badge outruns the list.
    expect(feed.count).toBe(1)
  })

  it("discounts observed overlap without guessing at unfetched rows", () => {
    const shared = row({ id: "shared", status: "approved" })
    const feed = buildFeed([
      source("release", [shared, row(), row()], 3),
      // 9 total, 1 of the 2 fetched already seen → 8 genuinely new.
      source("pickup", [shared, row({ status: "approved" })], 9),
    ])

    expect(feed.actionable).toHaveLength(4)
    expect(feed.count).toBe(11)
    expect(feed.truncated).toBe(true)
  })

  it("shows outcomes newest first and never lights the badge with them", () => {
    const feed = buildFeed([
      source("outcome", [
        row({ id: "older", status: "released", updated_at: "2026-07-30T00:00:00.000Z" }),
        row({ id: "newer", status: "rejected", updated_at: "2026-08-03T00:00:00.000Z" }),
      ]),
    ])

    expect(feed.recent.map((i) => i.id)).toEqual(["newer", "older"])
    expect(feed.recent.map((i) => i.headline)).toEqual(["Rejected", "Released"])
    expect(feed.count).toBe(0)
    expect(feed.truncated).toBe(false)
    expect(feed.actionable).toEqual([])
  })

  it("does not repeat a request in Recent that is already actionable", () => {
    const shared = row({ id: "shared", status: "approved" })
    const feed = buildFeed([
      source("pickup", [shared]),
      source("outcome", [shared]),
    ])

    expect(feed.actionable).toHaveLength(1)
    expect(feed.recent).toEqual([])
  })

  it("shapes an item for the panel", () => {
    const feed = buildFeed([
      source("endorse", [
        row({
          id: "abc",
          request_no: "RS-2026-0007",
          status: "awaiting_endorsement",
        }),
      ]),
    ])

    expect(feed.actionable[0]).toMatchObject({
      id: "abc",
      requestNo: "RS-2026-0007",
      kind: "endorse",
      headline: "Needs your endorsement",
      office: "ACCTG · City Accounting Office",
      requester: "Juan Dela Cruz",
      href: "/dashboard/requests/abc",
    })
  })

  it("falls back to requested_at when the row has never been updated", () => {
    const feed = buildFeed([
      source("review", [
        row({ requested_at: "2026-07-01T00:00:00.000Z", updated_at: null }),
      ]),
    ])

    expect(feed.actionable[0].at).toBe("2026-07-01T00:00:00.000Z")
  })

  it("tolerates a missing office join", () => {
    const feed = buildFeed([
      source("review", [row({ office: null, requester: null })]),
    ])

    expect(feed.actionable[0].office).toBeNull()
    expect(feed.actionable[0].requester).toBeNull()
  })
})
