import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

export default function PartyWaiversLoading() {
  return (
    <StaffPage width="reading">
      <Pending className="space-y-6">
        <Bone className="h-8 w-48" />
        <SectionCard as="div" pending className="h-64" />
      </Pending>
    </StaffPage>
  );
}
