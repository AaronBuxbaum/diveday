import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { EditorFormSkeleton } from "../../../dive-sites/_components/EditorFormSkeleton";

/**
 * The editor's sections, counted: the `sections` list in `./page.tsx` names
 * nine, four open and five closed (visual review 2026-10-24, A11).
 * `src/app/editor-skeletons.test.tsx` reads that list and fails when the two
 * disagree.
 */
const COURSE_EDITOR_SECTIONS = 9;
const COURSE_EDITOR_OPEN_SECTIONS = 4;

/**
 * Form-shaped skeleton for the course editor (design principle 1). Without
 * one, this route would inherit the public course page's hero-shaped
 * skeleton from the parent segment — a shape mismatch for a staff form.
 *
 * The open sections as bars on hairlines, the closed ones as rows of one
 * card, and the sticky Save, because that is what the page draws. A skeleton
 * still drawing a rail would paint the old editor for a moment on every
 * navigation in.
 */
export default function EditCourseLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        {/* The header's meta is one `text-sm` line — "Live at /s/…", or
            "Hidden from divers · Preview" — 12px under the title. Without its
            bar everything below the title dropped 32px on load (K-417). */}
        <ShopPageHeaderSkeleton
          description={false}
          meta={<div className="h-5 w-72 max-w-full rounded bg-surface-sunken" />}
        />
        <div className="mt-6">
          <EditorFormSkeleton
            open={COURSE_EDITOR_OPEN_SECTIONS}
            closed={COURSE_EDITOR_SECTIONS - COURSE_EDITOR_OPEN_SECTIONS}
          />
        </div>
      </div>
    </StaffPage>
  );
}
