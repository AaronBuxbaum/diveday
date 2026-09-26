import { ShopPageHeaderSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";
import { segmentedTrackClass } from "@/components/ui/segmented";

/**
 * Catalog-shaped skeleton for the diver-facing course list (design principle
 * 1): the header block, the agency tabs, then a group's label over the
 * hairline ledger the catalog renders — rows of a thumbnail beside the title,
 * pitch and fact line, with a price on the right. Course rows are per-shop
 * and visibility can change between requests, so none of it is in the static
 * shell — a diver browsing from the schedule sees this the instant they tap,
 * instead of a held page.
 *
 * **Every number is the page's** (K-380). It drew the header straight into
 * the list, with no tabs, no group label and no thumbnails, so at 1280 the
 * list landed about 111px lower than the skeleton put it, every title 80px
 * further right and every row 9px taller:
 *   - the tabs are the segmented track itself, one 44px option tall (54px),
 *     at the `mt-6` that collapses into the header's `mb-8`, as `AgencyTabs`'s.
 *     The shell cannot read the shop, so it draws the demo shop's two
 *     agencies. `AgencyTabs` draws nothing for a shop with one, and that
 *     shop's list lands 86px higher than this skeleton puts it (the track
 *     and the 32px under it), where the old skeleton was about 24px out;
 *   - the group is `mt-8`, a 16px `text-xs` label, then the list at `mt-2`,
 *     stepped 8px out with each row keeping the room as `px-2`, so its rules
 *     run where the page's do (K-513);
 *   - a row is `py-5` and `gap-4` round a `size-16` thumbnail, beside a 28px
 *     `text-lg` title, `mt-1` and a `text-sm` summary (two lines on a phone,
 *     one from `sm`), `mt-2` and the fact line, 80px of words; below `sm` the
 *     price drops under them `gap-2` down, as the page's does.
 */
export default function PublicCoursesLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        {/* No eyebrow bar: the page's header has none ("COURSES" over
            "Courses" was cut), and the default drew one anyway. The
            description is two lines on a phone. */}
        <ShopPageHeaderSkeleton
          eyebrow={false}
          titleWidth="w-48"
          description
          descriptionWidth="w-full max-w-2xl"
          descriptionLines={{ base: 2, sm: 1 }}
        />
        <div className={`${segmentedTrackClass} mt-6 w-fit`}>
          {[0, 1, 2].map((tab) => (
            <div key={tab} className="h-11 w-12" />
          ))}
        </div>
        <div className="mt-8">
          <div className="h-4 w-24 rounded bg-surface-sunken" />
          <div className="-mx-2 mt-2 divide-y divide-border border-y border-border">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-4 px-2 py-5">
                <div className="size-16 shrink-0 rounded-inset bg-surface-sunken" />
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:justify-between sm:gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
                    <div className="mt-1">
                      <SkeletonLineBars
                        lines={{ base: 2, sm: 1 }}
                        height="h-5"
                        width="w-full max-w-md"
                      />
                    </div>
                    <div className="mt-2 h-5 w-44 max-w-full rounded bg-surface-sunken" />
                  </div>
                  <div className="h-6 w-16 shrink-0 rounded bg-surface-sunken" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
