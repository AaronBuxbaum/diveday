import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for a diver's profile (design principle 1). Without
 * one, this route would inherit the Divers list's row-shaped skeleton from
 * the parent segment — a shape mismatch for a single profile page.
 */
export default function DiverProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-72 max-w-full" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
