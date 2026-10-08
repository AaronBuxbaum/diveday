import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Ticket-shaped skeleton: the page's own wrapping header row (name block,
 * then the Print button), then the units list frame and the due-back line —
 * the trip slip's skeleton (K-282) inside the register's page frame.
 */
export default function CounterRentalTicketLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div className="w-md max-w-full">
            <div className="h-4 w-16 rounded bg-surface-sunken" />
            <div
              className={`mt-1 h-lh ${SHELL_TITLE_CLASS} w-56 max-w-full rounded bg-surface-sunken`}
            />
            <div className="mt-1 h-6 w-48 max-w-full rounded bg-surface-sunken" />
          </div>
          <div className="h-12 w-40 rounded-lg bg-surface-sunken" />
        </div>
        <div className={`mt-8 h-lh ${SECTION_TITLE_CLASS} w-40 rounded bg-surface-sunken`} />
        <div className={sectionCardClass({ padding: "none", className: "mt-3 h-40 w-full" })} />
        <div className="mt-6 h-lh w-64 max-w-full rounded bg-surface-sunken text-lg" />
      </div>
    </main>
  );
}
