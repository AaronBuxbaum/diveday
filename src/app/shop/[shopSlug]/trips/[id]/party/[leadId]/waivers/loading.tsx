import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { SectionCard } from "@/components/ui/card";

export default function PartyWaiversLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 rounded bg-surface-sunken" />
        <SectionCard as="div" pending className="h-64" />
      </div>
    </StaffPage>
  );
}
