import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { EditorFormSkeleton } from "../_components/EditorFormSkeleton";
import {
  SITE_FORM_OPEN_SECTIONS,
  SITE_FORM_SECTION_ORDER,
} from "../_components/site-form-sections";

/**
 * Form-shaped skeleton for the new-dive-site editor (ADR
 * 20260804-instant-navigation).
 *
 * Without this file the route fell back to
 * `src/app/shop/[shopSlug]/dive-sites/loading.tsx`, the site *library*, at
 * `max-w-6xl` — so a staffer tapping "Add a dive site" watched a table
 * skeleton and landed on a narrow form. It tracks the page's own shape: the
 * header with its back link as its eyebrow, the open sections on hairlines,
 * the closed ones as rows of one card, and the sticky Save (visual review
 * 2026-10-24, A11).
 */
export default function NewDiveSiteLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        {/* The header's eyebrow bar is the back link: the page draws one,
            as the header's own eyebrow. A second, standalone bar above it
            stood every bar below 36px lower than what replaced it (K-423). */}
        <ShopPageHeaderSkeleton
          titleWidth="w-56"
          description
          descriptionIsCaption
          descriptionWidth="w-80 max-w-full"
        />

        <div className="mt-8">
          <EditorFormSkeleton
            open={SITE_FORM_OPEN_SECTIONS.size}
            closed={SITE_FORM_SECTION_ORDER.length - SITE_FORM_OPEN_SECTIONS.size}
          />
        </div>
      </div>
    </main>
  );
}
