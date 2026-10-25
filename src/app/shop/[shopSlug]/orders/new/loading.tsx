import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Form-shaped skeleton for recording a new order. */
export default function NewOrderLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} actions />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          {["diver", "item", "amount", "note"].map((slot) => (
            <div key={slot} className="mt-4 first:mt-0">
              <div className="h-4 w-24 rounded bg-surface-sunken" />
              <div className="mt-2 h-12 w-full rounded-lg bg-surface-sunken" />
            </div>
          ))}
          <div className="mt-6 h-11 w-44 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </StaffPage>
  );
}
