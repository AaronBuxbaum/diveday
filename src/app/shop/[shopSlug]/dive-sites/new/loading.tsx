import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Pending } from "@/components/ui/pending";
import { EditorFormSkeleton } from "../_components/EditorFormSkeleton";
import {
  SITE_FORM_OPEN_SECTIONS,
  SITE_FORM_SECTION_ORDER,
} from "../_components/site-form-sections";

export default function NewDiveSiteLoading() {
  return (
    <StaffPage width="reading">
      <Pending>
        <ShopPageHeader pending titleWidth="w-56" description />
        <div className="mt-8">
          <EditorFormSkeleton
            open={SITE_FORM_OPEN_SECTIONS.size}
            closed={SITE_FORM_SECTION_ORDER.length - SITE_FORM_OPEN_SECTIONS.size}
          />
        </div>
      </Pending>
    </StaffPage>
  );
}
