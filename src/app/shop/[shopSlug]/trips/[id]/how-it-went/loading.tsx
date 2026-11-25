import { Bone, Pending } from "@/components/ui/pending";
import { StaffPage } from "../../../_components/StaffPage";

export default function Loading() {
  return (
    <StaffPage>
      <Pending>
        <Bone className="h-10 w-72" />
        <Bone className="h-32 w-full" />
        <Bone className="h-48 w-full" />
      </Pending>
    </StaffPage>
  );
}
