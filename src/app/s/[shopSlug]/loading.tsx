import { sectionCardClass } from "@/components/ui/card";
import {
  DAY_LABEL_COLUMN_CLASS,
  DAY_NUMERAL_CLASS,
  WEEK_ROW_BOX_CLASS,
  WEEK_TIME_RAIL_CLASS,
} from "./_components/WeekLedger";

/**
 * Content-shaped skeleton for the shopfront (design principle 1): the identity
 * band leads into the next boat, and the week follows.
 *
 * **Every number is the loaded page's** (K-214). This drew a text hero and one
 * `max-w-md` card, 360px of band, where the page had grown a cover photograph,
 * a rating line, a badge wall and a full-width row of identity panels: 953px
 * at 1280 on the photo shop, so the week landed about 590px below where the
 * skeleton drew it. Read off the page, and to move with it:
 *   - the cover panel is `ShopfrontHero`'s, `aspect-[4/3]` and `sm:aspect-[16/7]`
 *     inside a hairline, then its `mb-6`. A shop with no photograph wears a
 *     shorter sky panel instead; the skeleton draws the photograph, the demo
 *     shop's and the taller of the two;
 *   - the rating line is 24px, and the badge wall's chips are `min-h-9` at
 *     `mt-4`, `gap-2`, wrapping on a phone as the badges do;
 *   - the panels are the page's row (`md:auto-cols-fr md:grid-flow-col`,
 *     `gap-4`, `mt-6`), 344px from `md` and stacked below it at the heights the
 *     live boat, the next boat and the season measure on a phone;
 *   - the week opens at the page's section gap (`SECTION_GAP`, 48px): a 28px
 *     heading over a 20px zone line, the 44px month row, a row of 44px lens
 *     pills and the 44px filter disclosure, each at the page's own margin;
 *   - a day's header is 40px of weekday and month over `pt-2 pb-3`, and a
 *     departure starts 16px in from `sm` (`sm:px-4`), a 24px time, a 24px
 *     title over a 20px meta line, and a 24px price. The columns those bars
 *     stand in are the ledger's own (`WeekLedger`'s exported classes).
 *
 * **Which shop it draws is a choice, and this is what it costs.** The shell is
 * served before anything reads the shop (the layout is synchronous: ADR
 * 20260804-instant-navigation), so it cannot know whether this shop has a
 * cover photograph, lenses, or a month either side. It draws the demo shop,
 * which has all three. A shop with no photograph, the shape of every shop
 * until it uploads one, loads a band about 436px shorter at 1280 than this
 * skeleton draws (`storefront-sky`: 517px, a 140px sky, and that minted shop
 * has no rating line or badge chips either), so its week rises when it lands;
 * the old text skeleton drew that band about 157px too short. A shop with no
 * lenses loads no pill row, and one with no month either side no month row:
 * 60px each, both drawn here for every shop.
 */
export default function TripsLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="mb-6 overflow-hidden rounded-panel border border-border bg-surface-sunken shadow-bed">
          <div className="aspect-[4/3] w-full sm:aspect-[16/7]" />
        </div>
        <div className="h-6 w-48 rounded bg-surface-sunken" />
        <div className="mt-4 flex flex-wrap gap-2">
          {["w-24", "w-44", "w-36", "w-52"].map((width) => (
            <div key={width} className={`h-9 ${width} rounded-full bg-surface-sunken`} />
          ))}
        </div>
        <div className="mt-6 grid gap-4 md:auto-cols-fr md:grid-flow-col">
          {["h-52", "h-63", "h-84"].map((height) => (
            <div
              key={height}
              className={sectionCardClass({ padding: "none", className: `${height} md:h-86` })}
            />
          ))}
        </div>
      </div>
      <div className="mt-12 animate-pulse">
        <div className="mb-4">
          <div className="h-7 w-28 rounded bg-surface-sunken" />
          <div className="mt-1 h-5 w-72 max-w-full rounded bg-surface-sunken" />
        </div>
        <div className="mb-4 flex items-center gap-2">
          <div className="h-6 w-32 rounded bg-surface-sunken" />
          <div className="size-11 rounded-lg bg-surface-sunken" />
        </div>
        <div className="mb-4 flex gap-2 overflow-hidden">
          {["w-36", "w-32", "w-24", "w-28"].map((width) => (
            <div key={width} className={`h-11 ${width} shrink-0 rounded-full bg-surface-sunken`} />
          ))}
        </div>
        <div className="mb-6 flex h-11 items-center">
          <div className="h-5 w-16 rounded bg-surface-sunken" />
        </div>
        {/* Two day groups: the calendar date block, then borderless rows with
            one meta line each. The block and the rows are drawn from the
            ledger's own column classes — the numeral's two tabular digits,
            the weekday column, the row's box and its time rail — so the
            hairline, the time and the title start where the loaded ones do.
            An empty numeral block is exactly its `2ch` minimum. */}
        {[0, 1].map((day) => (
          <div key={day} className={day === 0 ? "" : "mt-8"}>
            <div className="flex items-center gap-3 pt-2 pb-3">
              <div className={`${DAY_NUMERAL_CLASS} h-8 rounded bg-surface-sunken`} />
              <div className={DAY_LABEL_COLUMN_CLASS}>
                <div className="h-5 pt-1">
                  <div className="h-full w-10 rounded bg-surface-sunken" />
                </div>
                <div className="h-5 pt-1">
                  <div className="h-full w-10 rounded bg-surface-sunken" />
                </div>
              </div>
              <div className="h-px flex-1 bg-border" />
            </div>
            {[0, 1].map((row) => (
              <div key={row} className={`${WEEK_ROW_BOX_CLASS} sm:items-start`}>
                <div className={WEEK_TIME_RAIL_CLASS}>
                  <div className="h-6 w-36 rounded bg-surface-sunken" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />
                  <div className="mt-1 h-5 w-64 max-w-full rounded bg-surface-sunken" />
                </div>
                <div className="h-6 w-20 shrink-0 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
