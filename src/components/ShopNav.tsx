import Link from "next/link";
import { signOut } from "@/lib/auth";
import { ShopNavLinks } from "./ShopNavLinks";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export function ShopNav({ shopSlug, shopName }: { shopSlug: string; shopName: string }) {
  const root = `/shop/${shopSlug}`;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <Link href={root} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm transition-transform duration-200 hover:rotate-6">
            <span aria-hidden="true">✦</span>
            <span className="sr-only">Scuba home</span>
          </span>
          <span className="hidden max-w-40 truncate sm:inline">{shopName}</span>
          <span className="sm:hidden">Scuba</span>
        </Link>
        <ShopNavLinks root={root} />
        <Link
          href={`${root}/trips/new`}
          className="hidden min-h-11 shrink-0 items-center rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover sm:inline-flex"
        >
          <span aria-hidden="true" className="mr-1">
            +
          </span>{" "}
          New trip
        </Link>
        <form action={signOutAction} className="shrink-0">
          <button
            type="submit"
            aria-label="Sign out"
            className="min-h-11 rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground"
          >
            <span className="hidden sm:inline">Sign out</span>
            <span className="sm:hidden" aria-hidden="true">
              ↪
            </span>
          </button>
        </form>
      </div>
    </header>
  );
}
