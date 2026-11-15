import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

export default function ComputerDivesLoading() {
  return (
    <StaffPage width="reading">
      <Pending>
        <ShopPageHeader pending description={false} titleWidth="w-56" />
        <div className="mt-10 space-y-6">
          <Bone shape="control" className="h-12 w-full" />
          {[0, 1, 2].map((row) => (
            <Bone key={row} className="h-16 w-full" />
          ))}
        </div>
      </Pending>
    </StaffPage>
  );
}
