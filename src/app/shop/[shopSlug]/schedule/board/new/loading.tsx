import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

export default function AddDepartureLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton eyebrow={true} titleWidth="w-48" description={false} actions={0} />
        <div className="mt-6 h-80 rounded-inset bg-surface-sunken" />
      </div>
    </StaffPage>
  );
}
