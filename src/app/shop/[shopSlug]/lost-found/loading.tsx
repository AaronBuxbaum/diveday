import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for Lost and found: the title, then three hairline
 * rows the height of a found item with its line of facts and its buttons.
 */
export default function LostFoundLoading() {
  return (
    <StaffPage width="reading">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-48" description={false} />
        <div className="divide-y divide-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="space-y-2 py-3">
              <Bone className="h-5 w-48 max-w-full" />
              <Bone className="h-4 w-72 max-w-full" />
              <div className="flex gap-2">
                <Bone shape="control" className="h-11 w-28" />
                <Bone shape="control" className="h-11 w-24" />
              </div>
            </div>
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
