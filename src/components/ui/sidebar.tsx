"use client"

import * as React from "react"
import { PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent } from "@/components/ui/sheet"

const SIDEBAR_WIDTH = "14rem"

// ─── Context ──────────────────────────────────────────────────────────────────

interface SidebarContextValue {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) throw new Error("useSidebar must be used inside <SidebarProvider>")
  return ctx
}

// ─── Mobile hook ──────────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)")
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  return isMobile
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  children,
  className,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)
  const [_open, _setOpen] = React.useState(defaultOpen)

  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean) => {
      _setOpen(value)
      onOpenChange?.(value)
    },
    [onOpenChange]
  )

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((prev) => !prev)
    } else {
      setOpen(!open)
    }
  }, [isMobile, open, setOpen])

  const ctx = React.useMemo<SidebarContextValue>(
    () => ({
      state: open ? "expanded" : "collapsed",
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [open, setOpen, openMobile, isMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={ctx}>
      <div
        data-sidebar="provider"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            ...style,
          } as React.CSSProperties
        }
        className={cn("flex min-h-svh w-full bg-background", className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar({
  side = "left",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
}) {
  const { state, openMobile, setOpenMobile, isMobile } = useSidebar()

  // Mobile: use Sheet
  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side={side}
          className="w-[var(--sidebar-width)] bg-sidebar p-0 border-r-0"
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
          >
            {children}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop: animate width
  return (
    <div
      data-sidebar="sidebar"
      data-state={state}
      className={cn(
        "group/sidebar hidden md:flex flex-col shrink-0 overflow-hidden bg-sidebar text-sidebar-foreground",
        // Pinned to the viewport: self-start stops the flex row from
        // stretching it, so sticky has room to work while the page scrolls.
        "sticky top-0 self-start h-svh",
        "transition-[width] duration-200 ease-in-out",
        state === "expanded"
          ? "w-[var(--sidebar-width)]"
          : "w-0",
        className
      )}
      {...props}
    >
      {/* Inner keeps its width so content doesn't wrap during animation */}
      <div className="flex h-full w-[var(--sidebar-width)] min-w-[var(--sidebar-width)] flex-col">
        {children}
      </div>
    </div>
  )
}

// ─── Sidebar sub-layout ───────────────────────────────────────────────────────

export function SidebarHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="header"
      className={cn("flex shrink-0 flex-col", className)}
      {...props}
    />
  )
}

export function SidebarContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="content"
      className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}
      {...props}
    />
  )
}

export function SidebarFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="footer"
      className={cn("flex shrink-0 flex-col p-2", className)}
      {...props}
    />
  )
}

export function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="separator"
      className={cn("mx-3 my-1 h-px bg-sidebar-border", className)}
      {...props}
    />
  )
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export function SidebarGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="group"
      className={cn("flex w-full flex-col gap-0.5 px-3 py-2", className)}
      {...props}
    />
  )
}

export function SidebarGroupLabel({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-sidebar="group-label"
      className={cn(
        "mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export function SidebarMenu({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-sidebar="menu"
      className={cn("flex w-full flex-col gap-0.5", className)}
      {...props}
    />
  )
}

export function SidebarMenuItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-sidebar="menu-item"
      className={cn("relative", className)}
      {...props}
    />
  )
}

// ─── Trigger ──────────────────────────────────────────────────────────────────

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      type="button"
      data-sidebar="trigger"
      onClick={(e) => {
        onClick?.(e)
        toggleSidebar()
      }}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
        className
      )}
      {...props}
    >
      <PanelLeft className="h-4 w-4" />
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  )
}

// ─── Main content inset ───────────────────────────────────────────────────────

export function SidebarInset({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-sidebar="inset"
      className={cn("relative flex min-h-svh flex-1 flex-col overflow-hidden", className)}
      {...props}
    />
  )
}
