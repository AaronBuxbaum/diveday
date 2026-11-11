import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";
import { StaffPage } from "../_components/StaffPage";
import { StaffSectionTabsSkeleton } from "../_components/StaffSectionTabs";
export default function Loading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-48" description={false} />
        <StaffSectionTabsSkeleton section="courses" />
        <div className="mt-8 space-y-6">
          <Bone className="h-8 w-48" />
          <Bone className="h-24 w-full" />
        </div>
      </Pending>
    </StaffPage>
  );
}
