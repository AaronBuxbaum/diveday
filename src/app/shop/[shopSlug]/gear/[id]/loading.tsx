import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Pending } from "@/components/ui/pending";

export default function GearUnitLoading() {
  return (
    <StaffPage width="reading">
      <Pending>
        {/* The header skeleton's own eyebrow is the page's one "‹ Gear
            register" line. A second bar above it put the heading 32px low
            until the page arrived (K-431). */}
        <ShopPageHeader pending description descriptionWidth="w-64 max-w-full" />
        <div className="mt-8 flex flex-col gap-10">
          {[0, 1, 2].map((i) => (
            <SectionCard key={i} as="div" pending padding="none" className="h-40" />
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
