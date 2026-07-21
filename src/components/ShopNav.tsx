import Link from "next/link";
import { signOut } from "@/lib/auth";
import { ShopNavLinks } from "./ShopNavLinks";
import { buttonClass } from "./ui/button";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export function ShopNav({
  shopSlug,
  shopName,
  boatCheckInHref,
}: {
  shopSlug: string;
  shopName: string;
  /** Today's next departure's check-in, when the shop has a boat out today. */
  boatCheckInHref?: string;
}) {
  const root = `/shop/${shopSlug}`;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-3 shadow-sm backdrop-blur print:hidden sm:px-6">
      {/*
       * On phones the primary links wrap to their own full-width row below the
       * logo instead of being crushed into whatever slice of the top row is
       * left over (which forced a cramped horizontal scroll). On sm+ everything
       * collapses back to a single row via the `order` utilities.
       */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={root}
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight sm:order-1"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm transition-transform duration-200 hover:rotate-6">
            <span aria-hidden="true">✦</span>
            <span className="sr-only">Scuba home</span>
          </span>
          <span className="hidden max-w-40 truncate sm:inline">{shopName}</span>
          <span className="sm:hidden">Scuba</span>
        </Link>
        {/* Trips are created from the Schedule, where the surrounding week is visible. */}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:order-3 sm:ml-0 sm:gap-3">
          <form action={signOutAction} className="shrink-0" data-scroll-reset="true">
            <button
              type="submit"
              aria-label="Sign out"
              className={buttonClass({ variant: "ghost", size: "sm", className: "rounded-xl" })}
            >
              Sign out
            </button>
          </form>
        </div>
        <ShopNavLinks
          root={root}
          boatCheckInHref={boatCheckInHref}
          className="order-last w-full sm:order-2 sm:w-auto sm:flex-1"
        />
      </div>
    </header>
  );
}
