import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";
import { StaffSectionTabsSkeleton } from "../_components/StaffSectionTabs";
import { figureCellClass } from "../reports/_components/MonthFigures";

/** The stats page's skeleton: the section's title and tabs, the four figures, the course list. */
export default function StatsLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-32" description={false} />
        <StaffSectionTabsSkeleton section="money" />
        <div className="-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className={figureCellClass(index, 4)}>
              <Bone className="h-3 w-20" />
              <Bone className="mt-3 h-8 w-28" />
              <Bone className="mt-3 h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-10 space-y-3">
          <Bone className="h-3 w-20" />
          {[0, 1, 2].map((row) => (
            <Bone key={row} className="h-10 w-full" />
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
