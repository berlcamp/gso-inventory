"use client"

import { useCallback, useEffect, useRef, useState, Suspense } from "react"
import { usePathname, useSearchParams } from "next/navigation"

function Progress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)
  const incrementRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevUrl = useRef<string | null>(null)

  const url = `${pathname}?${searchParams}`

  // Declared before the effects that call them — the lint rules treat a
  // hoisted function referenced from an effect as an access before declaration.
  const start = useCallback(() => {
    if (incrementRef.current) clearInterval(incrementRef.current)
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current)

    setVisible(true)
    setWidth(0)

    let w = 0
    incrementRef.current = setInterval(() => {
      // Slow crawl that tapers off approaching 80%
      w = w < 20 ? w + 6 : w < 50 ? w + 4 : w < 70 ? w + 2 : w < 80 ? w + 1 : w
      setWidth(w)
      if (w >= 80) clearInterval(incrementRef.current!)
    }, 150)
  }, [])

  const complete = useCallback(() => {
    if (incrementRef.current) clearInterval(incrementRef.current)
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current)

    setWidth(100)
    completeTimerRef.current = setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 350)
  }, [])

  // Complete bar when URL actually changes
  useEffect(() => {
    if (prevUrl.current === null) {
      prevUrl.current = url
      return
    }
    if (prevUrl.current === url) return
    prevUrl.current = url
    // Deferred so the finishing animation doesn't cascade a render from
    // inside the effect body.
    const id = setTimeout(complete, 0)
    return () => clearTimeout(id)
  }, [url, complete])

  // Start bar on any internal link click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const anchor = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute("href") ?? ""
      // Skip external, hash, or non-navigation links
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) return
      start()
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [start])

  if (!visible) return null

  return (
    <div
      className="fixed top-0 left-0 z-[9999] h-0.5 bg-primary"
      style={{
        width: `${width}%`,
        transition: width === 100 ? "width 200ms ease-out" : "width 150ms linear",
        boxShadow: "0 0 6px 1px hsl(var(--primary) / 0.5)",
      }}
    />
  )
}

export function NavigationProgress() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  )
}
