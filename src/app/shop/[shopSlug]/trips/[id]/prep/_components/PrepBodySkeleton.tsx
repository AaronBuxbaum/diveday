import { ShopStatSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Mirrors `PrepBody` while its reads load: title, basis line, three-wide tiles
 * at every width, kit cards, and assignments, with the caller's section gap.
 *
 * Its own file rather than a second export from `PrepBody.tsx`: both callers
 * are boundaries a reader waits at, and importing the list itself would pull
 * the gear actions and both pickers into the chunk that is supposed to paint
 * first.
 *
 * Keep the heading, basis line, and three-wide tiles aligned with the list at
 * every width. This separate chunk keeps gear actions and pickers out of the
 * loading path; the skeleton cannot know whether nitrox tiles will appear.
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
