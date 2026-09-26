import { SkeletonLineBars } from "@/components/ShopPageHeader";

/**
 * The hero's title, a line box per line: `text-5xl` / `sm:text-6xl` /
 * `lg:text-7xl` at `leading-none`, so 48, 60 and 72px lines. It wraps to six
 * lines on a 390px phone and five at 1280 (measured), and to four across the
 * `sm` band, where 60px type has the 592–672px column to itself. Each entry is
 * the line's visibility: the fifth line is gone across `sm` and back from
 * `lg`, the sixth is a phone's alone.
 */
const TITLE_LINE_HEIGHT = "h-12 sm:h-15 lg:h-18";
const TITLE_LINES = [
  ["one", ""],
  ["two", ""],
  ["three", ""],
  ["four", ""],
  ["five", "sm:hidden lg:block"],
  ["six", "sm:hidden"],
] as const;

/**
 * What the static shell paints while the landing's localized body
 * (`LocalizedHomeBody` in src/app/page.tsx) resolves — this page's equivalent
 * of the `loading.tsx` that `/product` and `/pricing` carry, rendered inside
 * the page because the root segment cannot have one (see the `instant` note in
 * the page).
 *
 * Shaped like the hero and the first daily-moment row so the streamed body
 * lands where the bars stood. Nothing in here is a link, a button, or a form:
 * that is the fix, not an economy.
 *
 * **The hero is drawn a line box per line, as the page sets it** (K-393). It
 * drew two title bars for a title of five or six lines, two description bars
 * for three or four, the bordered three-field "try it" panel the hero lost
 * when shops began to be set up by hand, and a guessed 480px phone. The
 * numbers are read off the hero in src/app/page.tsx and move with it:
 *   - the eyebrow, `MARKETING_EYEBROW_CLASS`: one 20px `text-sm` line;
 *   - the title, `mt-5`: `TITLE_LINES` above;
 *   - the description, `mt-6`, `leading-8`: four 32px lines on a phone, three
 *     from `sm` in its `max-w-xl`;
 *   - the doors, `mt-8`: two 48px buttons, stacked below `sm`;
 *   - the demo note (`mt-3`) and the price line (`mt-2`): 20px lines, two each
 *     on a phone and one from `sm`;
 *   - the phone: `CaptainPhoneFrame` renders 450px tall at 342px wide on a
 *     phone and at 448px from `lg` (its height is its mockup's, not a ratio);
 *   - the dock card under it, `-mt-5`, `py-3`: a 16px label over a detail
 *     line that wraps to three 20px lines in the card's narrower widths and
 *     two from `lg`.
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
              <SkeletonLineBars lines={{ base: 4, sm: 3 }} height="h-8" width="w-full max-w-xl" />
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
            <div className="h-[450px] rounded-[2.5rem] border border-border bg-surface" />
            <div className="mx-auto -mt-5 w-[88%] rounded-inset border border-border bg-surface px-4 py-3">
              <div className="h-4 w-24 rounded bg-surface-sunken" />
              <div className="mt-1">
                <div className="h-5 w-full rounded bg-surface-sunken" />
                <div className="h-5 pt-1">
                  <div className="h-full w-full rounded bg-surface-sunken" />
                </div>
                <div className="h-5 pt-1 lg:hidden">
                  <div className="h-full w-2/3 rounded bg-surface-sunken" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The day, told in alternating proof rows — one of them, at height. */}
      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <div className="h-9 w-full max-w-lg rounded bg-surface-sunken" />
          <div className="mt-3 h-9 w-3/4 max-w-md rounded bg-surface-sunken" />
        </div>
        <div className="mt-14 grid items-center gap-8 lg:mt-20 lg:grid-cols-11 lg:gap-14">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-4">
              <div className="h-4 w-28 rounded bg-surface-sunken" />
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
            <div className="mt-4 h-8 w-full max-w-sm rounded bg-surface-sunken" />
            <div className="mt-3 h-4 w-full max-w-md rounded bg-surface-sunken" />
            <div className="mt-2 h-4 w-2/3 max-w-sm rounded bg-surface-sunken" />
          </div>
          <div className="lg:col-span-6">
            <div className="h-80 rounded-panel border border-border bg-surface shadow-bed" />
          </div>
        </div>
      </section>
    </main>
  );
}
