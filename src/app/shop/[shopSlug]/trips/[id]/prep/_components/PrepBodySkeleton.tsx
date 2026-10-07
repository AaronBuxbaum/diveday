import { ShopStatSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/**
 * The packing list's own shape while its reads are in flight — the Tanks
 * heading and the line saying where its total comes from, three tank tiles,
 * the kit cards, the assignments table — stacked at the gap the caller hands
 * `PrepBody` too, so nothing moves when the list arrives (K-487).
 *
 * Its own file rather than a second export from `PrepBody.tsx`: both callers
 * are boundaries a reader waits at, and importing the list itself would pull
 * the gear actions and both pickers into the chunk that is supposed to paint
 * first.
 *
 * **The top is the list's own top, line for line** (K-188). It predated the
 * per-dive basis line and the tiles' `grid-cols-3`: a bar short of the
 * heading, nothing for the basis line (two lines on a phone), and three
 * `h-28` boxes in `sm:grid-cols-3` — stacked 360px tall below 640px, where
 * the list draws one 98px row. On the departure page that collapse came right
 * after a jump to `#packing-list`. So: each section title in its own line box
 * (`SECTION_TITLE_CLASS`, the size the list sets every section title at), the
 * basis line's two phone lines and one desk line, the note under the tiles the
 * same, and `ShopStat`'s own tile three across at every width. Three because
 * a shop that offers nitrox draws Total, Air and Nitrox; one without draws
 * Total alone, which the skeleton cannot know.
 */
export function PrepBodySkeleton({ className }: { className: string }) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div>
        <div className={`h-lh ${SECTION_TITLE_CLASS} w-32 rounded bg-surface-sunken`} />
        <div className="mt-1">
          <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-md max-w-full" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <ShopStatSkeleton key={i} />
          ))}
        </div>
        <div className="mt-2">
          <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-xl max-w-full" />
        </div>
      </div>
      {/* The kit cards, each a section of the stack, as the list draws them. */}
      {[0, 1, 2].map((i) => (
        <div key={i} className={sectionCardClass({ padding: "md", className: "h-36" })} />
      ))}
      <div>
        <div className={`h-lh ${SECTION_TITLE_CLASS} w-40 rounded bg-surface-sunken`} />
        <div className={sectionCardClass({ padding: "none", className: "mt-3 h-64" })} />
      </div>
    </div>
  );
}
