import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";
import { requirePlatformSession } from "@/lib/session";
import { AdminNavLinks } from "./AdminNavLinks";

/**
 * The operator console's shell (docs ADR 20260724-resend-webhook-email-events).
 *
 * Gating the layout as well as each page is deliberate: a page added under
 * `/admin` later inherits the check rather than having to remember it. Every
 * page still calls its own `requirePlatformSession`, because a layout is not a
 * security boundary in the App Router — it can be skipped on a client-side
 * navigation to a route that renders without it.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { access } = await requirePlatformSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href="/admin/inbox"
            className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <LogoMark className="size-5" />
              <span className="sr-only">DiveDay operator console</span>
            </span>
            <span className="hidden sm:inline">DiveDay</span>
          </Link>
          <AdminNavLinks canManageAddresses={access.isAdmin} className="flex-1" />
          <Link
            href="/"
            className={buttonClass({ variant: "ghost", size: "sm", className: "rounded-xl" })}
          >
            Leave console
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
