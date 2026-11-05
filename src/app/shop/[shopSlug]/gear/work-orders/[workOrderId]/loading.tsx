import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Ticket-shaped skeleton (design principle 1): the page's wrapping header row
 * — whose gear it is, its badges, and the Claim tag button beside them — then
 * the first three cards the ticket opens with, at about the heights they
 * stand at, so arriving at a ticket does not shift under the cursor.
 */
export default function WorkOrderLoading() {
  return (
    <StaffPage width="reading">
      <Pending>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-md max-w-full">
            <Bone className="h-4 w-24" />
            <Bone className={`mt-1 h-lh ${SHELL_TITLE_CLASS} w-56 max-w-full`} />
            <Bone className="mt-1 h-6 w-64 max-w-full" />
          </div>
          <Bone shape="control" className="h-12 w-32" />
        </div>
        <div className="mt-8 space-y-10">
          <SectionCard as="div" pending padding="none" className="h-48 w-full" />
          <SectionCard as="div" pending padding="none" className="h-44 w-full" />
          <SectionCard as="div" pending padding="none" className="h-56 w-full" />
        </div>
      </Pending>
    </StaffPage>
  );
}
