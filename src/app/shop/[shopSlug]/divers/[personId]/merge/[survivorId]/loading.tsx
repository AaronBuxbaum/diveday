import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/** Shaped like the merge preview: its header, the details table, the moves table, the button. */
export default function MergeDiverLoading() {
  return (
    <StaffPage width="reading">
      <Pending>
        <ShopPageHeader pending description={false} />
        <div className="mt-8 space-y-10">
          {["h-96", "h-64"].map((height) => (
            <div
              key={height}
              className={`${height} rounded-panel border border-border bg-surface`}
            />
          ))}
          <Bone shape="control" className="h-12 w-56" />
        </div>
      </Pending>
    </StaffPage>
  );
}
