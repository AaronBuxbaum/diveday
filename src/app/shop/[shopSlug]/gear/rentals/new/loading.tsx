import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Form-shaped skeleton for renting gear out: the who card, then the search row. */
export default function RentOutLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-40" description={false} />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="h-5 w-24 rounded bg-surface-sunken" />
          <div className="mt-4 h-4 w-32 rounded bg-surface-sunken" />
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <div className="h-12 flex-1 rounded-lg bg-surface-sunken" />
            <div className="h-12 w-28 rounded-lg bg-surface-sunken" />
          </div>
        </div>
      </div>
    </StaffPage>
  );
}
