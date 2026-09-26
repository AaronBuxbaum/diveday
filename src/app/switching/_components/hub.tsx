import { SkeletonLineBars, type SkeletonLines } from "@/components/ShopPageHeader";
import { SwitchingConciergeSkeleton } from "@/components/SwitchingConcierge";
import { MIGRATION_GUIDES } from "@/lib/migration-guides";
import { HubGuideRowSkeleton } from "./HubGuideRow";

/*
 * The switching hub's boxes, spelled once for the page (`../page.tsx`) and for
 * {@link SwitchHubBodySkeleton}, so the skeleton cannot draw a different box
 * from the one that replaces it.
 */
export const HUB_HERO_CLASS = "mx-auto max-w-4xl px-6 pt-16 pb-10 lg:pt-24 lg:pb-14";
export const HUB_LIST_SECTION_CLASS = "mx-auto max-w-4xl px-6 pb-16 lg:pb-24";
/** The "not listed here" row that closes the list, its words beside the doors from `lg`. */
export const HUB_CLOSING_ROW_CLASS =
  "flex flex-col gap-6 border-b border-border py-8 lg:flex-row lg:items-center lg:justify-between";
export const HUB_PREVIEW_BAND_CLASS = "border-y border-border bg-surface";
export const HUB_PREVIEW_BOX_CLASS = "mx-auto max-w-4xl px-6 py-16 lg:py-20";

/**
 * How far each guide's summary wraps in its hub row, keyed by the guide's slug
 * (`spreadsheet` for the spreadsheet guide): counted in en-US on the hub's
 * capture of 2026-09-25, 28px lines at 390 and 1280. How far a page's words
 * wrap is the page's business, not the row skeleton's. Copy edits move these;
 * `hub.test.tsx` holds every row the hub lists to an entry.
 */
export const HUB_ROW_SUMMARY_LINES: Record<string, SkeletonLines> = {
  spreadsheet: { base: 3, sm: 1 },
  fareharbor: { base: 4, sm: 2 },
  eve: { base: 5, sm: 2 },
  diveshop360: { base: 4, sm: 2 },
  smartwaiver: { base: 5, sm: 2 },
  rezdy: { base: 4, sm: 2 },
};

/**
 * What the static shell paints while the hub's localized body resolves (K-406).
 *
 * It lives beside the page rather than in a `src/app/switching/loading.tsx`,
 * which is the arrangement ADR 20260804-instant-navigation otherwise asks for:
 * `loading.tsx` is the boundary for a segment **and everything under it**, and
 * `/switching` has children — `/switching/[competitor]`, whose hero-and-rail
 * body looks nothing like this index of links. `/switching/spreadsheet`
 * carries its own, so a file there would only ever mis-shape the competitor
 * guides. Same reasoning as `src/app/page.tsx`, for the same structural reason.
 *
 * Each section is drawn in the hub's own box, with a bar the height of each
 * line its words wrap to: the hero's 20px eyebrow, 40px title lines (48 from
 * `sm`) and 32px lede lines; a row per guide, off the same registry the list
 * itself is built from (`HubGuideRowSkeleton`); the closing row's words and
 * its two 48px doors; the import preview band at the mock's measured height;
 * and the concierge (`SwitchingConciergeSkeleton`). The bars it had were a
 * 105px row for rows of 111–223, 20px lede bars for 32px lines, no doors, and
 * nothing below the list, so everything under the hero shifted as the body
 * landed.
 *
 * Nothing in it is a link, a button, or a form. That is the fix, not an
 * economy: a fallback holds shape, never interaction.
 */
export function SwitchHubBodySkeleton() {
  const bar = "rounded bg-surface-sunken";
  const door = "h-12 w-full rounded-lg bg-surface-sunken";
  return (
    <main className="flex-1 animate-pulse">
      <section className={HUB_HERO_CLASS}>
        <div className={`h-5 w-44 ${bar}`} />
        {/* `DISPLAY_TITLE_CLASS`'s 40px lines, `sm:text-5xl`'s 48: two lines at 390 and 1280. */}
        <div className="mt-4">
          <SkeletonLineBars lines={2} height="h-10 sm:h-12" width="w-full max-w-xl" />
        </div>
        <div className="mt-5">
          <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-8" width="w-full max-w-2xl" />
        </div>
      </section>

      <section className={HUB_LIST_SECTION_CLASS}>
        {/* The index: the spreadsheet row, then one per incumbent guide. */}
        <ul className="border-t border-border">
          {["spreadsheet", ...MIGRATION_GUIDES.map((guide) => guide.slug)].map((slug) => (
            <HubGuideRowSkeleton key={slug} summaryLines={HUB_ROW_SUMMARY_LINES[slug]} />
          ))}
        </ul>
        {/* The "not listed here" row that closes the list, and its two doors. */}
        <div className={HUB_CLOSING_ROW_CLASS}>
          <div>
            <div className={`h-7 w-40 ${bar}`} />
            <div className="mt-1.5">
              <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-7" width="w-full max-w-xl" />
            </div>
          </div>
          <div className="lg:shrink-0">
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <div className={`${door} sm:w-40`} />
              <div className={`${door} sm:w-28`} />
            </div>
          </div>
        </div>
      </section>

      {/* The import preview band: eyebrow, the heading's 36px lines (40 from
          sm), the mock at the height it renders (446px at 390, 414 from sm),
          four one-line notes (two lines on a phone) and the door's line. */}
      <section className={HUB_PREVIEW_BAND_CLASS}>
        <div className={HUB_PREVIEW_BOX_CLASS}>
          <div className={`h-5 w-56 ${bar}`} />
          <div className="mt-4">
            <SkeletonLineBars
              lines={{ base: 3, sm: 2 }}
              height="h-9 sm:h-10"
              width="w-full max-w-2xl"
            />
          </div>
          <div className="mt-8 h-[446px] rounded-panel border border-border bg-surface-sunken sm:h-[414px]" />
          <div className="mt-8 max-w-2xl space-y-3">
            {[0, 1, 2, 3].map((note) => (
              <div key={note}>
                <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-6" width="w-full" />
              </div>
            ))}
          </div>
          {/* The door is a link-weight md button: 8px above, a 48px line. */}
          <div className="mt-2 flex h-12 items-center">
            <div className={`h-5 w-56 ${bar}`} />
          </div>
        </div>
      </section>

      <SwitchingConciergeSkeleton />
    </main>
  );
}
