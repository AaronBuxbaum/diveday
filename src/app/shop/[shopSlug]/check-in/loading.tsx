import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for Check-in (design principle 1) — the readiness
 * lookup across today's departures has no loading state to show meanwhile,
 * and this page runs during the morning rush.
 *
 * Shaped to the counter instrument it stands in for (ADR
 * 20260827-clearwater-surface-language, decision 9): the departure chips, the
 * boat and its count figure over the meter, the search box, then hairline
 * queue rows — not the stack of bordered cards this surface used to be, which
 * would land the real page a layout jump away from its own skeleton.
 */
export default function CheckInLoading() {
  return (
    // flex-1 to match the page it stands in for — without it the shop layout's
    // footer hugs the skeleton, then drops when the real page lands.
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />
        {/* The departure chips: one sunken track. */}
        <div className="mt-6 h-13 w-full max-w-md rounded-inset bg-surface-sunken" />
        <div className="mt-6">
          <div className="h-6 w-64 max-w-full rounded bg-surface-sunken" />
          <div className="mt-1.5 h-4 w-48 rounded bg-surface-sunken" />
          {/* The figure, then its 5px meter. */}
          <div className="mt-6 h-10 w-40 rounded bg-surface-sunken" />
          <div className="mt-3 h-[5px] w-full rounded-full bg-surface-sunken" />
        </div>
        <div className="mt-6 h-11 w-full max-w-xl rounded-lg bg-surface-sunken" />
        <div className="mt-8">
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex min-h-14 items-center justify-between gap-4 border-t border-border px-4 last:border-b sm:px-5"
            >
              <div className="h-5 w-44 max-w-full rounded bg-surface-sunken" />
              <div className="h-6 w-24 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
