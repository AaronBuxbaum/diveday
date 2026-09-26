import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Slip-shaped skeleton: the name block, then the units list frame. Sized like
 * the body it stands in for so arriving at the ticket does not jump.
 *
 * **The header is the page's own wrapping row** (K-282). It drew the name
 * block alone, while the page's header puts the 48px Print button beside the
 * name on a desk and wraps it under the name on a phone: at 390 the header's
 * rule, and the unit list under it, dropped 84px when the slip arrived. So the
 * row is the page's (`loading.test.tsx` reads the page's class list), the
 * button is a bar of its size, and the text block is the page's lines: the
 * eyebrow's 16px, then the name and the trip line 4px apart, the trip line
 * two lines on a phone and one from `sm`. The text block is about as wide as
 * the trip line's words, which is what decides where the row wraps; its width
 * is on the block, capped at the row, because a fixed-width bar inside a flex
 * item would set that item's minimum and run it off a phone.
 */
export default function RentalTicketLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div className="w-md max-w-full">
          <div className="h-4 w-16 rounded bg-surface-sunken" />
          <div
            className={`mt-1 h-lh ${SHELL_TITLE_CLASS} w-56 max-w-full rounded bg-surface-sunken`}
          />
          <div className="mt-1">
            <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-6" width="w-full" />
          </div>
        </div>
        <div className="h-12 w-40 rounded-lg bg-surface-sunken" />
      </div>
      <div className={`mt-8 h-lh ${SECTION_TITLE_CLASS} w-40 rounded bg-surface-sunken`} />
      <div className={sectionCardClass({ padding: "none", className: "mt-3 h-40 w-full" })} />
      <div className="mt-6 h-lh w-64 max-w-full rounded bg-surface-sunken text-lg" />
    </div>
  );
}
