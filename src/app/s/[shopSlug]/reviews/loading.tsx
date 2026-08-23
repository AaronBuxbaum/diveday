import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the public review archive (ADR
 * 20260804-instant-navigation).
 *
 * Without this file the route fell back to `src/app/s/[shopSlug]/loading.tsx`,
 * the *schedule* skeleton, at `max-w-6xl` — so a diver tapping "83 reviews"
 * watched day headers and departure rows at the wrong width and then landed on
 * a 4xl column of review cards. The width here tracks the page's own
 * `max-w-4xl` container, and the card shells come from `sectionCardClass()`,
 * the same place `ReviewCards` takes its own.
 */
export default function PublicReviewsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" descriptionWidth="w-80 max-w-full" />

        {/* The aggregate line: star row, then the average and count, then the
            verified note under it. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-5 w-28 rounded bg-surface-sunken" />
          <div className="h-4 w-40 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className="mt-1 h-4 w-64 max-w-full rounded bg-surface-sunken" />

        {/* Two rows of the two-up card grid `ReviewCards` renders. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((card) => (
            <div key={card} className={sectionCardClass({ className: "h-32" })} />
          ))}
        </div>
      </div>
    </main>
  );
}
