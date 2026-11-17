import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for a run's page (ADR 20260804-instant-navigation): the
 * header with the run's line, the cadence card and the run-wide acts.
 */
export default function SeriesLoading() {
  return (
    <Pending as={StaffPage}>
      <ShopPageHeader pending titleWidth="w-32 max-w-full" description />
      <div className="mt-8 space-y-6">
        <SectionCard as="div" pending padding="lg">
          <Bone className="h-5 w-48 max-w-full" />
          <Bone shape="control" className="mt-3 h-11 w-full" />
          <Bone shape="control" className="mt-3 h-11 w-40" />
        </SectionCard>
        <SectionCard as="div" pending padding="lg">
          <Bone className="h-5 w-56 max-w-full" />
          <Bone className="mt-2 h-5 w-40 max-w-full" />
        </SectionCard>
      </div>
    </Pending>
  );
}
