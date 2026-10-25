import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a past day (ADR 20260804-instant-navigation): the
 * header with its weekday line, the departures label, then two settled
 * stations at the evening's shape — the time, the title, the status line and
 * its doors. Mirrors the page's `<main>`: a staff page at `full` width.
 */
export default function PastDayLoading() {
  return (
    <StaffPage width="full" className="animate-pulse">
      <ShopPageHeaderSkeleton
        titleWidth="w-56 max-w-full"
        description={false}
        meta={<div className="h-5 w-24 max-w-full rounded bg-surface-sunken" />}
      />
      <div className="mt-8 h-4 w-24 rounded bg-surface-sunken" />
      <div className="mt-3 flex flex-col gap-5">
        {["w-48", "w-56"].map((width) => (
          <div key={width} className={sectionCardClass({ padding: "lg" })}>
            <div className="h-7 w-20 rounded bg-surface-sunken" />
            <div className={`mt-1.5 h-6 ${width} max-w-full rounded bg-surface-sunken`} />
            <div className="mt-1.5 h-5 w-64 max-w-full rounded bg-surface-sunken" />
            <div className="mt-3 h-11 w-32 rounded-lg bg-surface-sunken" />
          </div>
        ))}
      </div>
    </StaffPage>
  );
}
