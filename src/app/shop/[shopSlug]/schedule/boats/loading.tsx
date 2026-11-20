import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";
import { ScheduleViewsSkeleton } from "../_components/ScheduleViews";

/** A day's shape: the header, the views, then two boats with a departure or two each. */
export default function BoatsDayLoading() {
  return (
    <Pending as={StaffPage} width="full">
      <ShopPageHeader pending titleWidth="w-56 max-w-full" description={false} />
      <ScheduleViewsSkeleton />
      <div className="mt-8 space-y-10">
        {["w-32", "w-40"].map((width) => (
          <div key={width}>
            <Bone className={`h-4 ${width}`} />
            <Bone className="mt-3 h-6 w-64 max-w-full" />
            <Bone className="mt-1.5 h-4 w-40 max-w-full" />
          </div>
        ))}
      </div>
    </Pending>
  );
}
