import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the blow-out page (ADR 20260804-instant-navigation):
 * header, then the confirm card — the lead, the money note, the roster of
 * divers who will be messaged, and the one danger button. Mirrors the page's
 * own markup — like the page, no `<main>` of its own; the shop layout's
 * `#shop-main-content` wrapper is the landmark.
 *
 * **The confirm state, not the record state.** One URL renders two quite
 * different bodies (`if (!blowout)` in `page.tsx`): the confirm card at
 * `max-w-2xl`, and — once a blow-out has been called — a full-width
 * `sm:grid-cols-3` row of stat tiles above a five-column table. A skeleton can
 * only stand in for one of them, and this is the one a staffer arrives at:
 * the trip page's `weatherBlowout` button is rendered only while the trip is
 * live, so that door always lands here, and its sibling `viewBlowout` link is
 * gated on a blow-out already existing. The confirm branch is also the slower
 * of the two — it awaits `getTripRoster` *after* the page's `Promise.all`
 * resolves — so its skeleton is the one on screen longest. This file was
 * shaped like the record state until issue #867: three full-width stat tiles
 * and a wide table were painted, then replaced by one narrow card.
 *
 * The page's notice banner slot (`<div className="mt-6">`, empty on every
 * arrival that carries no `?notice=`) is deliberately not reproduced: an empty
 * block's margins collapse through, so the header's `mb-8` is the whole gap
 * above the card in the real page too.
 */
export default function BlowoutLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        titleWidth="w-64 max-w-full"
        // The header carries `meta`, never a description: the trip's name and
        // its date/time line, two `text-sm` rows at `gap-1`.
        description={false}
        meta={
          <div className="flex flex-col gap-1">
            <div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />
            <div className="h-5 w-72 max-w-full rounded bg-surface-sunken" />
          </div>
        }
      />
      {/* `max-w-2xl` is the card's own width on the page. A skeleton wider
          than what replaces it is the sideways jump the principle is about,
          and the card is the narrower of the two bodies this route renders. */}
      <div className={sectionCardClass({ padding: "lg", className: "max-w-2xl" })}>
        {/* The lead, then the money note — `text-sm` paragraphs that wrap. */}
        <div className="flex flex-col gap-1">
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-3/4 rounded bg-surface-sunken" />
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-2/3 rounded bg-surface-sunken" />
        </div>
        {/* "N divers will be messaged", then the roster list at its `gap-1`. */}
        <div className="mt-5">
          <div className="h-5 w-52 max-w-full rounded bg-surface-sunken" />
          <div className="mt-2 flex flex-col gap-1">
            {["w-44", "w-52", "w-40"].map((width) => (
              <div key={width} className={`h-5 ${width} max-w-full rounded bg-surface-sunken`} />
            ))}
          </div>
        </div>
        {/* The danger submit — `min-h-11`, like every button in the app. */}
        <div className="mt-6 h-11 w-44 rounded-lg bg-surface-sunken" />
      </div>
    </div>
  );
}
