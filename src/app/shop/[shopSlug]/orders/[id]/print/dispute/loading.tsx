import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Document-shaped skeleton for the dispute sheet (design principle 1): the
 * header block, then the order, waiver, check-in, roll-call and activity
 * sections that read per request. It mirrors the page's own wrapper so the
 * sections do not jump when the sheet arrives.
 */
export default function DisputeSheetLoading() {
  return (
    <StaffPage width="reading" className="space-y-10">
      <div className="animate-pulse space-y-10">
        <div className="border-b border-border pb-6">
          <div className="h-4 w-32 rounded bg-surface-sunken" />
          <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
          <div className="mt-2 h-6 w-80 max-w-full rounded bg-surface-sunken" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className={sectionCardClass({ padding: "lg" })}>
            <div className="h-12 rounded-inset bg-surface-sunken" />
          </div>
        ))}
      </div>
    </StaffPage>
  );
}
