import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { StaffSectionTabsSkeleton } from "@/app/shop/[shopSlug]/_components/StaffSectionTabs";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/** The Drills tab's skeleton: the title, the tabs, and the four tiles. */
export default function SafetyDrillsLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-32" description={false} />
        <StaffSectionTabsSkeleton section="safety" />
        <Bone className="mb-3 h-7 w-24" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <Bone key={tile} shape="control" className="h-48 w-full" />
          ))}
        </div>
        <Bone shape="control" className="mt-4 h-16 w-full" />
      </Pending>
    </StaffPage>
  );
}
