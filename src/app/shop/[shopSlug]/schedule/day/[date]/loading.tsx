import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for a past day (ADR 20260804-instant-navigation): the
 * header with its weekday line, the departures label, then two settled
 * stations at the evening's shape — the time, the title, the status line and
 * its doors. Mirrors the page's `<main>`: a staff page at `full` width.
 */
export default function PastDayLoading() {
  return (
    <Pending as={StaffPage} width="full">
      <ShopPageHeader
        pending
        titleWidth="w-56 max-w-full"
        description={false}
        meta={<Bone className="h-5 w-24 max-w-full" />}
      />
      <Bone className="mt-8 h-4 w-24" />
      <div className="mt-3 flex flex-col gap-5">
        {["w-48", "w-56"].map((width) => (
          <SectionCard key={width} as="div" pending padding="lg">
            <Bone className="h-7 w-20" />
            <Bone className={`mt-1.5 h-6 ${width} max-w-full`} />
            <Bone className="mt-1.5 h-5 w-64 max-w-full" />
            <Bone shape="control" className="mt-3 h-11 w-32" />
          </SectionCard>
        ))}
      </div>
    </Pending>
  );
}
