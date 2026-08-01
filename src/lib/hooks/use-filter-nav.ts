"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

export type FilterValues = Record<string, string | boolean>

const SEARCH_DEBOUNCE_MS = 350

/**
 * Drives a list page's URL-backed filters.
 *
 * Two things it fixes over reading `useSearchParams()` directly in the
 * controls:
 *
 * 1. The controls render from `draft`, which updates on the same tick as the
 *    click. Bound to the URL, a `<Select>` kept displaying the old value until
 *    the server round trip finished, so the click looked like it did nothing.
 * 2. `isPending` stays true for the whole navigation, so the page can swap in
 *    a skeleton instead of leaving stale rows on screen.
 *
 * Keys of `filters` are used verbatim as search-param names. Empty strings and
 * `false` are dropped from the URL; `true` is written as `"1"`.
 */
export function useFilterNav<T extends FilterValues>(path: string, filters: T) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [draft, setDraft] = useState(filters)

  // The URL state already reconciled with. Lets us ignore the URL catching up
  // to a change we made, while still adopting external ones (back/forward).
  const [syncedKey, setSyncedKey] = useState(() => keyOf(filters))
  if (keyOf(filters) !== syncedKey) {
    setSyncedKey(keyOf(filters))
    setDraft(filters)
  }

  /** Navigates to `next`. `extra` carries params the filters don't own (page). */
  function navigate(next: T, extra?: Record<string, string>) {
    setSyncedKey(keyOf(next))

    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(next)) {
      if (value === true) params.set(key, "1")
      else if (typeof value === "string" && value) params.set(key, value)
    }
    for (const [key, value] of Object.entries(extra ?? {})) {
      if (value) params.set(key, value)
    }

    const query = params.toString()
    startTransition(() => {
      router.push(`${path}${query ? `?${query}` : ""}`, { scroll: false })
    })
  }

  /** Changes some filters and navigates. Always returns to the first page. */
  function apply(patch: Partial<T>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    navigate(next)
  }

  /** Keeps the current filters and moves to another page of results. */
  function goToPage(page: number) {
    navigate(draft, page > 1 ? { page: String(page) } : undefined)
  }

  /**
   * For free-text inputs: updates the control on every keystroke but only
   * navigates once typing pauses. `flush` runs the pending navigation now
   * (on submit) so Enter still works.
   */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function applyDebounced(patch: Partial<T>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => navigate(next), SEARCH_DEBOUNCE_MS)
  }

  function flush() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    navigate(draft)
  }

  return {
    draft,
    setDraft,
    isPending,
    apply,
    applyDebounced,
    flush,
    navigate,
    goToPage,
  }
}

function keyOf(filters: FilterValues) {
  return Object.entries(filters)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&")
}
