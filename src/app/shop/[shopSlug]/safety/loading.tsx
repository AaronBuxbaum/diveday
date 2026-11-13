import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader, SkeletonLineBars } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";
import { StaffSectionTabsSkeleton } from "../_components/StaffSectionTabs";
import { figureCellClass } from "../reports/_components/MonthFigures";

/**
 * The Safety page's skeleton, in the page's own order: the page's title, the
 * one-line intro, the month heading and its stepper (as Reports draws
 * it), the five figures, and the three list cards.
 */
export default function SafetyReportLoading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-32" description={false} />
        <div className="mb-6">
          <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-6" width="w-160 max-w-full" />
        </div>
        <StaffSectionTabsSkeleton section="safety" />
        <Bone shape="control" className="mb-6 h-11 w-44" />
        <div className="mb-6 flex items-center gap-3">
          <Bone shape="control" className="size-12" />
          <Bone className="h-7 w-40" />
          <Bone shape="control" className="size-12" />
        </div>
        <div className="-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className={`${figureCellClass(index)}${index === 4 ? " sm:col-span-2 lg:col-span-1" : ""}`}
            >
              <Bone className="h-3 w-20" />
              <Bone className="mt-3 h-8 w-28" />
              <Bone className="mt-3 h-3 w-24" />
            </div>
          ))}
        </div>
        <Bone className="mt-3 h-10 w-full max-w-prose" />
        <div className="mt-10 space-y-10">
          {[0, 1, 2].map((card) => (
            <SectionCard key={card} as="div" pending className="h-36" />
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
