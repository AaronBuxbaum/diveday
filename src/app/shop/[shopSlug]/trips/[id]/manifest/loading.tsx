import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { segmentedTrackClass } from "@/components/ui/segmented";

/**
 * Roll-call-shaped skeleton for the boat manifest (design principle 1). Like
 * its sibling `trips/[id]/loading.tsx` this renders as the trip layout's
 * children, so the masthead above stays put and only the manifest body swaps —
 * a captain switching to Manifest at the dock sees the list frame immediately
 * rather than a held page on marina Wi-Fi.
 *
 * Shaped to the surface as it is since ADR
 * 20260827-the-departure-is-two-working-surfaces: **the count leads**, then
 * where the boat is, then the checkpoint switch, then the one-line boat check,
 * then the roll call's heading over the ruled list of rows whose trailing edge
 * is a 56px mark. It used to draw the checkpoint switch first and rows with no
 * mark at all, which is a picture of the previous page — the skeleton a reader
 * watches has to be the page they land on, or the whole boundary is a layout
 * jump with extra steps. It then drew no stage strip and no roll-call heading,
 * a full-width 48px bar for the switch and a 144px count panel, and the roll
 * call arrived about 174px below the grey list it replaced (K-263).
 */
/** The five stage taps (`StageStrip`). */
const STAGE_TAPS = ["boarding", "underway", "surface", "heading_in", "home"] as const;

export default function ManifestLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        titleWidth="w-64 max-w-full"
        // The page wears TripPageHeader, which has no description line and
        // which these bars only approximate; left as they were until that
        // header has a skeleton of its own.
        description
        descriptionWidth="w-72 max-w-full"
        meta={<div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />}
      />
      {/* The count panel at rest: the checkpoint over the figure. */}
      <div className={sectionCardClass({ padding: "md", className: "mt-4 h-28" })} />
      {/* Where the boat is: its label, then the five taps on the strip's own
          equal columns, 3 + 2 on a phone and one line of five from `sm`.
          `mt-6` is the prose line's `pt-2` under the panel and the strip's own
          `mt-4`. */}
      <div className="mt-6">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 grid grid-cols-3 gap-2 sm:max-w-2xl sm:grid-cols-5">
          {STAGE_TAPS.map((stage) => (
            <div key={stage} className="h-11 rounded-lg bg-surface-sunken" />
          ))}
        </div>
      </div>
      {/* The checkpoint switch: the boat-size track (56px segments in the
          shared well), as wide as its words rather than the page. */}
      <div className={`mt-7 w-72 max-w-full ${segmentedTrackClass}`}>
        <div className="h-14" />
      </div>
      {/* From the boat check down, the page's one stack (K-189). */}
      <div className="mt-5 space-y-10">
        <div className={sectionCardClass({ padding: "none", className: "h-14" })} />
        <div>
          <div className="h-7 w-40 max-w-full rounded bg-surface-sunken" />
          {/* The roll call is one ruled list card, so its skeleton is the same
              single card — not a stack of floating bars that redraws into a
              different shape when the list streams in. */}
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-3 divide-y divide-border overflow-hidden",
            })}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <li
                key={i}
                className="flex h-19 items-center gap-3 border-l-4 border-border-strong bg-surface-sunken/60 ps-4 pe-3"
              >
                <div className="size-8 shrink-0 rounded-lg bg-surface-sunken" />
                <div className="h-4 w-40 max-w-full flex-1 rounded bg-surface-sunken" />
                <div className="size-14 shrink-0 rounded-full bg-surface-sunken" />
              </li>
            ))}
          </ul>
        </div>
        <div className={sectionCardClass({ padding: "md", className: "h-28" })} />
      </div>
    </div>
  );
}
