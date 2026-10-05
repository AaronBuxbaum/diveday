import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { BANNER_TITLE_CLASS, LEAD_TITLE_CLASS } from "@/components/ui/typography";

/**
 * The hero's title, a line box per line: `text-5xl` / `sm:text-6xl` /
 * `lg:text-7xl` at `leading-none`, so 48, 60 and 72px lines. It wraps to four
 * lines on a 390px phone and to three across the `sm` band and at 1280
 * (measured). Each entry is the line's visibility: the fourth is a phone's
 * alone.
 */
const TITLE_LINE_HEIGHT = "h-12 sm:h-15 lg:h-18";
const TITLE_LINES = [
  ["one", ""],
  ["two", ""],
  ["three", ""],
  ["four", "sm:hidden"],
] as const;

/**
 * What the static shell paints while the landing's localized body
 * (`LocalizedHomeBody` in src/app/page.tsx) resolves — this page's equivalent
 * of the `loading.tsx` that `/product` and `/pricing` carry, rendered inside
 * the page because the root segment cannot have one (see the `instant` note in
 * the page).
 *
 * Shaped like the hero and the first step of the booking band so the streamed
 * body lands where the bars stood. Nothing in here is a link, a button, or a
 * form: that is the fix, not an economy.
 *
 * **The hero is drawn a line box per line, as the page sets it** (K-393). The
 * numbers are read off the hero in src/app/page.tsx and move with its copy;
 * the 2026-10-05 rewrite (H-93) shortened the title and lengthened the lede:
 *   - the eyebrow, `MARKETING_EYEBROW_CLASS`: one 20px `text-sm` line;
 *   - the title, `mt-5`: `TITLE_LINES` above;
 *   - the description, `mt-6`, `leading-8`: five 32px lines on a phone, four
 *     from `sm` in its `max-w-xl`;
 *   - the doors, `mt-8`: two 48px buttons, stacked below `sm`;
 *   - the demo note (`mt-3`) and the price line (`mt-2`): 20px lines, two each
 *     on a phone and one from `sm`;
 *   - the phone: `CaptainPhoneFrame` renders 544px tall at every width (its
 *     height is its mockup's, not a ratio; the skeleton drew 450 after the
 *     roll call grew);
 *   - the dock card under it, `-mt-5`, `py-3`: a 16px label over a detail
 *     line that wraps to three 20px lines in a phone's 342px column and two
 *     from `sm`, where the column is `max-w-sm`.
 *
 * **The first step is drawn at its height**, the same way: the band's title
 * (three lines on a phone, two from `sm`), then the row — the marker, the
 * step's title (two lines on a phone, one across `sm`, two again in the
 * narrower `lg` column), two notes of two lines each, the 48px link to the
 * feature page, and the booking screen at the 323px it renders at. Below `lg`
 * it stacks in the page's phone order, the screen between the title and the
 * notes, from the same `contents` and `order` classes the page uses; from `lg`
 * the copy is a column beside the screen again.
 */
export function HomeBodySkeleton() {
  return (
    <main className="flex-1 animate-pulse">
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:py-24">
          <div className="max-w-2xl">
            <div className="h-5 w-40 rounded bg-surface-sunken" />
            <div className="mt-5">
              {TITLE_LINES.map(([line, only]) =>
                line === "one" ? (
                  <div
                    key={line}
                    className={`${TITLE_LINE_HEIGHT} w-full rounded bg-surface-sunken`}
                  />
                ) : (
                  <div key={line} className={`${TITLE_LINE_HEIGHT} pt-1 ${only}`}>
                    <div className="h-full w-11/12 rounded bg-surface-sunken" />
                  </div>
                ),
              )}
            </div>
            <div className="mt-6">
              <SkeletonLineBars lines={{ base: 5, sm: 4 }} height="h-8" width="w-full max-w-xl" />
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
            </div>
            <div className="mt-3">
              <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-72 max-w-full" />
            </div>
            <div className="mt-2">
              <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-64 max-w-full" />
            </div>
          </div>
          {/* The captain's phone, and the card that overlaps its lower edge. */}
          <div className="mx-auto w-full max-w-sm lg:max-w-md">
            <div className="h-[544px] rounded-[2.5rem] border border-border bg-surface" />
            <div className="mx-auto -mt-5 w-[88%] rounded-inset border border-border bg-surface px-4 py-3">
              <div className="h-4 w-24 rounded bg-surface-sunken" />
              <div className="mt-1">
                <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-5" width="w-full" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The booking, followed step by step — the first step, at height. */}
      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <SkeletonLineBars
            lines={{ base: 3, sm: 2 }}
            height={`h-lh ${BANNER_TITLE_CLASS} sm:text-4xl`}
            width="w-full max-w-lg"
          />
        </div>
        <div className="mt-14 grid items-center gap-5 lg:mt-20 lg:grid-cols-11 lg:gap-14">
          <div className="contents lg:col-span-5 lg:flex lg:flex-col">
            <div>
              <div className="flex items-center gap-4">
                <div className="h-5 w-28 rounded bg-surface-sunken" />
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              </div>
              <div className={`mt-3 ${LEAD_TITLE_CLASS} sm:text-3xl`}>
                <div className="h-lh w-full max-w-sm rounded bg-surface-sunken" />
                <div className="h-lh pt-1 sm:hidden lg:block">
                  <div className="h-full w-2/3 max-w-xs rounded bg-surface-sunken" />
                </div>
              </div>
            </div>
            <div className="order-2 max-w-lg space-y-3 ps-7 text-sm leading-6 lg:order-none lg:mt-5">
              <SkeletonLineBars lines={2} height="h-lh" width="w-full" />
              <SkeletonLineBars lines={2} height="h-lh" width="w-full" />
            </div>
            <div className="order-3 flex h-12 items-center lg:order-none lg:mt-4">
              <div className="h-5 w-36 rounded bg-surface-sunken" />
            </div>
          </div>
          <div className="order-1 lg:order-none lg:col-span-6">
            <div className="h-[323px] rounded-panel border border-border bg-surface" />
          </div>
        </div>
      </section>
    </main>
  );
}
