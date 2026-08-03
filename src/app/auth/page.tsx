"use client"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { toast } from "sonner"

const LOGIN_LOGOS = [
  { src: "/logo1.png", alt: "" },
  { src: "/logo2.png", alt: "" },
  { src: "/logo3.png", alt: "" },
  { src: "/logo4.png", alt: "" },
] as const

export default function AuthPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const searchParams = useSearchParams()
  const error = searchParams.get("error")
  const errorDetail = searchParams.get("detail")
  const [loading, setLoading] = useState(false)

  async function handleGoogleLogin() {
    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: "select_account",
        },
      },
    })

    if (error) {
      toast.error(error.message)
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full min-h-screen">
      {/* Left — branded panel */}
      <div className="relative hidden w-[58%] flex-col justify-between overflow-hidden bg-[#0b4ea2] bg-gradient-to-br from-[#1877F2] to-[#0a3d80] p-12 lg:flex">
        {/* Subtle grid pattern overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />

        {/* Radial glow */}
        <div className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-white/10 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-white/[0.07] blur-[100px]" />

        {/* Top — logo + wordmark */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
            <WarehouseIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">
            RIS &amp; Inventory
          </span>
        </div>

        {/* Middle — hero copy */}
        <div className="relative space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              <span className="text-xs font-medium text-white tracking-wide uppercase">
                General Services Office
              </span>
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
              Office Supplies
              <br />
              Inventory &amp;
              <br />
              <span className="text-[#BBD6FF]">Issuance System</span>
            </h1>
            <p className="max-w-sm text-base text-white/85 leading-relaxed">
              One ledger for every department&apos;s supply balance — requests,
              approvals, and releases recorded as they happen for LGU Ozamiz City.
            </p>
          </div>

          {/* Feature highlights */}
          <div className="grid grid-cols-1 gap-3">
            {[
              {
                icon: <RequestIcon className="h-4 w-4" />,
                label: "Supply Requests",
                desc: "Departments file requests online; walk-ins are logged at the counter",
              },
              {
                icon: <CheckIcon className="h-4 w-4" />,
                label: "Approval & Release",
                desc: "GSO approves quantities and records every issuance",
              },
              {
                icon: <LedgerIcon className="h-4 w-4" />,
                label: "Live Balances",
                desc: "Per-office remaining stock updated with each transaction",
              },
            ].map(({ icon, label, desc }) => (
              <div
                key={label}
                className="flex items-start gap-3 rounded-xl border border-white/15 bg-white/[0.08] p-3.5"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
                  {icon}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-white/75 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom — footer */}
        <div className="relative flex items-center justify-between border-t border-white/15 pt-6">
          <p className="text-xs text-white/75">LGU Ozamiz City</p>
          <p className="text-xs text-white/75">
            &copy; {new Date().getFullYear()} RIS &amp; Inventory System
          </p>
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-8">
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <WarehouseIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">
            RIS &amp; Inventory
          </span>
        </div>

        <div className="w-full max-w-[360px] space-y-8">
          {/* Heading */}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground">
              Sign in with your Google account to continue.
            </p>
          </div>

          {/* Login card */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <div
              className="flex flex-wrap items-center justify-center gap-3 border-b border-border/60 pb-4 -mt-0.5"
              role="presentation"
            >
              {LOGIN_LOGOS.map(({ src, alt }) => (
                <div key={src} className="relative h-12 w-[4.25rem] shrink-0">
                  <Image
                    src={src}
                    alt={alt}
                    fill
                    className="object-contain"
                    sizes="68px"
                  />
                </div>
              ))}
            </div>
            {error === "unauthorized" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
                <p className="text-sm font-medium text-destructive">
                  Access Denied
                </p>
                <p className="text-xs text-destructive mt-1">
                  Your account is not authorized to access this system. Ask the
                  GSO administrator to register your office email.
                </p>
              </div>
            )}
            {error === "deactivated" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
                <p className="text-sm font-medium text-destructive">
                  Account Deactivated
                </p>
                <p className="text-xs text-destructive mt-1">
                  This account has been deactivated. Contact the GSO
                  administrator.
                </p>
              </div>
            )}
            {error === "lookup_failed" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-center text-sm font-medium text-destructive">
                  Could Not Reach the Database
                </p>
                <p className="mt-1 text-center text-xs text-destructive">
                  Sign-in worked, but the account lookup failed — usually the
                  <code className="mx-1 font-mono">gso_inventory</code> schema is
                  not exposed in the Supabase API settings, or its migrations
                  have not been applied.
                </p>
                {errorDetail && (
                  <p className="mt-2 break-words rounded bg-destructive/10 p-2 text-center font-mono text-[11px] text-destructive">
                    {errorDetail}
                  </p>
                )}
              </div>
            )}
            {error &&
              error !== "unauthorized" &&
              error !== "deactivated" &&
              error !== "lookup_failed" && (
                <p className="text-sm text-destructive text-center">
                  Authentication failed. Please try again.
                </p>
              )}
            <Button
              className="w-full h-10 gap-2.5 text-sm font-medium"
              variant="outline"
              disabled={loading}
              onClick={handleGoogleLogin}
            >
              <GoogleIcon className="h-4 w-4 shrink-0" />
              {loading ? "Redirecting..." : "Continue with Google"}
            </Button>

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Access is restricted to authorized LGU personnel.
            </p>
          </div>

          {/* Help text */}
          <p className="text-center text-xs text-muted-foreground">
            Having trouble signing in?{" "}
            <span className="cursor-pointer font-medium text-primary hover:underline">
              Contact the GSO administrator
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function WarehouseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 9.5L12 4l9 5.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <path
        d="M8 21v-6h8v6"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function RequestIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path
        d="M9 12h6M9 16h4M14 3v4a1 1 0 001 1h4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LedgerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14" strokeLinecap="round" />
      <path d="M4 19h16" strokeLinecap="round" />
      <path d="M8 14v3M12 10v7M16 7v10" strokeLinecap="round" />
    </svg>
  )
}
