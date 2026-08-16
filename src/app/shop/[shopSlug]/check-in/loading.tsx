import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for Check-in (design principle 1) — the readiness
 * lookup across today's departures has no loading state to show meanwhile,
 * and this page runs during the morning rush.
 */
export default function CheckInLoading() {
  return (
    // flex-1 to match the page it stands in for — without it the shop layout's
    // footer hugs the skeleton, then drops when the real page lands.
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />
        <div className="mt-8 flex flex-col gap-6">
          {[0, 1].map((group) => (
            <div key={group} className={sectionCardClass({ padding: "none" })}>
              <div className="border-b border-border px-4 py-3">
                <div className="h-5 w-56 rounded bg-surface-sunken" />
                <div className="mt-1.5 h-4 w-40 rounded bg-surface-sunken" />
              </div>
              <div className="divide-y divide-border">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center justify-between px-4 py-3">
                    <div className="h-5 w-44 rounded bg-surface-sunken" />
                    <div className="h-9 w-24 rounded-lg bg-surface-sunken" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
