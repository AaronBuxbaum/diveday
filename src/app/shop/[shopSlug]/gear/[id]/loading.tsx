import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

export default function GearUnitLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        {/* The header skeleton's own eyebrow is the page's one "‹ Gear
            register" line. A second bar above it put the heading 32px low
            until the page arrived (K-431). */}
        <ShopPageHeaderSkeleton description descriptionWidth="w-64 max-w-full" />
        <div className="mt-8 flex flex-col gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-40" })} />
          ))}
        </div>
      </div>
    </StaffPage>
  );
}
