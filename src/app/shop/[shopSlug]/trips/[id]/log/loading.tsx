import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";
import { StaffPage } from "../../../_components/StaffPage";
export default function Loading() {
  return (
    <StaffPage width="full">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-48" description={false} />
        <Bone className="h-12 w-64" />
        <Bone className="h-48 w-full" />
      </Pending>
    </StaffPage>
  );
}
