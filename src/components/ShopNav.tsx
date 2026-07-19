import Link from "next/link";
import { signOut } from "@/lib/auth";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

const linkClass =
  "rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground";

export function ShopNav({ shopSlug, shopName }: { shopSlug: string; shopName: string }) {
  const root = `/shop/${shopSlug}`;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <Link href={root} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
            <span aria-hidden="true">✦</span>
            <span className="sr-only">Scuba home</span>
          </span>
          <span className="hidden max-w-40 truncate sm:inline">{shopName}</span>
          <span className="sm:hidden">Scuba</span>
        </Link>
        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          <Link href={root} className={linkClass}>
            Today
          </Link>
          <Link href={`${root}/divers`} className={linkClass}>
            Divers
          </Link>
          <Link href={`${root}/schedule`} className={linkClass}>
            Schedule
          </Link>
          <details className="relative shrink-0">
            <summary className={`${linkClass} list-none [&::-webkit-details-marker]:hidden`}>
              More{" "}
              <span aria-hidden="true" className="ml-1 text-xs">
                ⌄
              </span>
            </summary>
            <div className="absolute right-0 z-20 mt-2 grid w-[min(20rem,calc(100vw-2rem))] gap-4 rounded-2xl border border-border bg-surface p-4 shadow-xl sm:left-0 sm:right-auto sm:grid-cols-2">
              <div>
                <p className="px-3 text-xs font-semibold tracking-widest text-muted uppercase">
                  Prepare
                </p>
                <div className="mt-1 grid">
                  <Link href={`${root}/waivers`} className={linkClass}>
                    Waivers
                  </Link>
                  <Link href={`${root}/gear`} className={linkClass}>
                    Gear room
                  </Link>
                  <Link href={`${root}/nitrox`} className={linkClass}>
                    Nitrox
                  </Link>
                </div>
              </div>
              <div>
                <p className="px-3 text-xs font-semibold tracking-widest text-muted uppercase">
                  Plan
                </p>
                <div className="mt-1 grid">
                  <Link href={`${root}/courses`} className={linkClass}>
                    Courses
                  </Link>
                  <Link href={`${root}/dive-sites`} className={linkClass}>
                    Dive sites
                  </Link>
                  <Link href={`${root}/reports`} className={linkClass}>
                    Reports
                  </Link>
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="px-3 text-xs font-semibold tracking-widest text-muted uppercase">
                  Business
                </p>
                <div className="mt-1 grid sm:grid-cols-2">
                  <Link href={`${root}/orders`} className={linkClass}>
                    Orders
                  </Link>
                  <Link href={`${root}/settings/payments`} className={linkClass}>
                    Payments
                  </Link>
                </div>
              </div>
            </div>
          </details>
        </nav>
        <form action={signOutAction} className="shrink-0">
          <button
            type="submit"
            className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
