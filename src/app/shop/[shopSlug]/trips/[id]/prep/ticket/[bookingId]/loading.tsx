import { sectionCardClass } from "@/components/ui/card";

/**
 * Slip-shaped skeleton: the name block, then the units list frame. Sized like
 * the body it stands in for so arriving at the ticket does not jump.
 */
export default function RentalTicketLoading() {
  return (
    <div className="animate-pulse">
      <div className="border-b border-border pb-6">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-56 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-72 max-w-full rounded bg-surface-sunken" />
      </div>
      <div className="mt-8 h-6 w-40 rounded bg-surface-sunken" />
      <div className={sectionCardClass({ padding: "none", className: "mt-3 h-40 w-full" })} />
      <div className="mt-6 h-6 w-64 max-w-full rounded bg-surface-sunken" />
    </div>
  );
}
