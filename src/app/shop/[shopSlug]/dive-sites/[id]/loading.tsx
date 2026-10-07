import { EditorRailSkeleton } from "@/components/editor/EditorRail";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { SITE_FORM_RAIL_STUBS } from "../_components/site-form-sections";

/**
 * Form-shaped skeleton for one dive site's briefing (ADR
 * 20260804-instant-navigation).
 *
 * It used to draw four stacked cards, which is what the page looked like when
 * the briefing was a stack of bordered fieldsets. The page is a long-form
 * editor now — a section rail beside unboxed sections on hairlines (ADR
 * 20260827-the-shops-shelves) — so the skeleton is its twin, and the streamed
 * form lands where the bars stood instead of jumping a card's worth of
 * padding.
 */
export default function DiveSiteLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
      <div className="animate-pulse">
        {/* The header's eyebrow bar is the back link: the page draws one,
            as the header's own eyebrow. A second, standalone bar above it
            stood every bar below 36px lower than what replaced it (K-423). */}
        <ShopPageHeaderSkeleton
          titleWidth="w-72 max-w-full"
          description
          descriptionIsCaption
          descriptionWidth="w-full max-w-xl"
          // "Changes reach every upcoming dive…" is two lines at 390px.
          descriptionLines={{ base: 2, sm: 1 }}
          actions
        />

        {/* "Upcoming dives here", the card the page draws between its header
            and the editor for a site with departures (K-416): the card's
            title, then a hairline list bled to the card's edges, each row a
            departure and, for the soonest, its tide line — 68px of row. The
            list has no end, so three rows stand for it: the editor lands
            where a site with departures puts it, rather than a card's height
            higher. */}
        <div className={sectionCardClass({ className: "mt-8 overflow-hidden" })}>
          <div className="h-8 w-56 max-w-full rounded bg-surface-sunken" />
          <div className="-mx-4 mt-4 -mb-4 divide-y divide-border border-t border-border sm:-mx-5 sm:-mb-5">
            {[0, 1, 2].map((row) => (
              <div key={row}>
                <div className="flex h-17 flex-col justify-center gap-1 px-4 sm:px-5">
                  <div className="h-4 w-64 max-w-full rounded bg-surface-sunken" />
                  <div className="h-4 w-80 max-w-full rounded bg-surface-sunken" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 lg:grid lg:grid-cols-[13.75rem_1fr] lg:gap-x-14">
          {/* The jump row on a phone, the rail on a desktop: the rail's own
              boxes, one stub per section at its label's width, so the phone
              wrap takes the loaded rail's rows. */}
          <EditorRailSkeleton widths={SITE_FORM_RAIL_STUBS} />

          <div className="flex min-w-0 flex-col gap-6">
            {[0, 1, 2].map((section) => (
              <div key={section} className={section === 0 ? "" : "border-t border-border pt-6"}>
                <div className="h-3 w-32 rounded bg-surface-sunken" />
                <div className="mt-4 flex flex-col gap-5">
                  {[0, 1].map((field) => (
                    <div key={field}>
                      <div className="h-4 w-28 rounded bg-surface-sunken" />
                      <div className="mt-2 h-12 rounded-lg bg-surface-sunken" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* The one Save, in its sticky row. */}
            <div className="border-t border-border pt-3">
              <div className="h-11 w-40 rounded-lg bg-surface-sunken" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
