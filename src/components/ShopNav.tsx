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
    <header className="border-b border-border bg-surface/95 px-6 py-3 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3">
        <Link href={root} className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">
            S
          </span>
          <span className="hidden sm:inline">{shopName}</span>
          <span className="sm:hidden">Scuba</span>
        </Link>
        <nav aria-label="Primary" className="flex flex-1 flex-wrap items-center gap-1">
          <Link href={root} className={linkClass}>
            Today
          </Link>
          <Link href={`${root}/divers`} className={linkClass}>
            Divers
          </Link>
          <Link href={`${root}/schedule`} className={linkClass}>
            Schedule
          </Link>
          <details className="relative">
            <summary className={`${linkClass} list-none [&::-webkit-details-marker]:hidden`}>
              More <span aria-hidden="true">⌄</span>
            </summary>
            <div className="absolute left-0 z-20 mt-2 grid w-72 gap-4 rounded-xl border border-border bg-surface p-4 shadow-lg sm:grid-cols-2">
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
        <form action={signOutAction}>
          <button type="submit" className={linkClass}>
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
