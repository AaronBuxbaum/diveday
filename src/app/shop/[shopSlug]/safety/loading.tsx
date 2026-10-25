import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { figureCellClass } from "../reports/_components/MonthFigures";

/**
 * The Safety page's skeleton, in the page's own order: the page's title, the
 * one-line intro, the month heading and its stepper (as Reports draws
 * it), the five figures, and the three list cards.
 */
export default function SafetyReportLoading() {
  return (
    <StaffPage width="full">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton eyebrow={false} titleWidth="w-32" description={false} />
        <div className="mb-6">
          <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-6" width="w-160 max-w-full" />
        </div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="h-7 w-40 rounded bg-surface-sunken" />
          <div className="flex flex-wrap items-center gap-2">
            <div className="size-12 rounded-lg bg-surface-sunken" />
            <div className="h-12 w-44 rounded-lg bg-surface-sunken" />
            <div className="size-12 rounded-lg bg-surface-sunken" />
          </div>
        </div>
        <div className="-mx-2 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className={`${figureCellClass(index)}${index === 4 ? " sm:col-span-2 lg:col-span-1" : ""}`}
            >
              <div className="h-3 w-20 rounded bg-surface-sunken" />
              <div className="mt-3 h-8 w-28 rounded bg-surface-sunken" />
              <div className="mt-3 h-3 w-24 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        <div className="mt-3 h-10 w-full max-w-prose rounded bg-surface-sunken" />
        <div className="mt-10 space-y-10">
          {[0, 1, 2].map((card) => (
            <div key={card} className={sectionCardClass({ className: "h-36" })} />
          ))}
        </div>
      </div>
    </StaffPage>
  );
}
