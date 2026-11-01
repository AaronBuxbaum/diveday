import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { EditorFormSkeleton } from "../_components/EditorFormSkeleton";
import {
  SITE_FORM_OPEN_SECTIONS,
  SITE_FORM_SECTION_ORDER,
} from "../_components/site-form-sections";

/**
 * Form-shaped skeleton for one dive site's briefing (ADR
 * 20260804-instant-navigation).
 *
 * It used to draw four stacked cards, which is what the page looked like when
 * the briefing was a stack of bordered fieldsets. The page is a long-form
 * editor now — open sections on hairlines and the rest closed as rows of one
 * card (visual review 2026-10-24, A11) — so the skeleton is its twin, and the
 * streamed form lands where the bars stood.
 */
export default function DiveSiteLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        {/* The header eyebrow is the back link; do not add a second stub (K-423). */}
        <ShopPageHeaderSkeleton
          titleWidth="w-72 max-w-full"
          description
          descriptionIsCaption
          descriptionWidth="w-full max-w-xl"
          // "Changes reach every upcoming dive…" is two lines at 390px.
          descriptionLines={{ base: 2, sm: 1 }}
          actions
        />

        {/* Edit-only: reserve the UpcomingSiteTrips space for a site with departures (K-416). */}
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

        <div className="mt-8">
          <EditorFormSkeleton
            open={SITE_FORM_OPEN_SECTIONS.size}
            closed={SITE_FORM_SECTION_ORDER.length - SITE_FORM_OPEN_SECTIONS.size}
          />
        </div>
      </div>
    </StaffPage>
  );
}
