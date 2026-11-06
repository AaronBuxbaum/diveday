import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { Bone, Pending } from "@/components/ui/pending";

/** The title, the line under it and the Print button. */
export default function CounterDoctorFormLoading() {
  return (
    <StaffPage width="reading">
      <Pending className="space-y-6">
        <Bone className="h-4 w-32" />
        <Bone className="h-8 w-56" />
        <Bone className="h-5 w-full" />
        <Bone shape="control" className="h-11 w-28" />
      </Pending>
    </StaffPage>
  );
}
