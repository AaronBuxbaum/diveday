import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";
import { EditorFormSkeleton } from "../../../dive-sites/_components/EditorFormSkeleton";
import {
  COURSE_EDITOR_CLOSED_SECTIONS,
  COURSE_EDITOR_OPEN_SECTIONS,
} from "./course-editor-sections";

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
      <Pending>
        {/* The header's meta is one `text-sm` line — "Live at /s/…", or
            "Hidden from divers · Preview" — 12px under the title. Without its
            bar everything below the title dropped 32px on load (K-417). */}
        <ShopPageHeader
          pending
          description={false}
          meta={<Bone className="h-5 w-72 max-w-full" />}
        />
        <div className="mt-6">
          <EditorFormSkeleton
            open={COURSE_EDITOR_OPEN_SECTIONS.length}
            closed={COURSE_EDITOR_CLOSED_SECTIONS.length}
          />
        </div>
      </Pending>
    </StaffPage>
  );
}
