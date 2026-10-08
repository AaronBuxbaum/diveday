import { sectionCardClass } from "@/components/ui/card";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * Ticket-shaped skeleton (design principle 1): the page's wrapping header row
 * — whose gear it is, its badges, and the Claim tag button beside them — then
 * the first three cards the ticket opens with, at about the heights they
 * stand at, so arriving at a ticket does not shift under the cursor.
 */
export default function WorkOrderLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-md max-w-full">
            <div className="h-4 w-24 rounded bg-surface-sunken" />
            <div
              className={`mt-1 h-lh ${SHELL_TITLE_CLASS} w-56 max-w-full rounded bg-surface-sunken`}
            />
            <div className="mt-1 h-6 w-64 max-w-full rounded bg-surface-sunken" />
          </div>
          <div className="h-12 w-32 rounded-lg bg-surface-sunken" />
        </div>
        <div className="mt-8 space-y-10">
          <div className={sectionCardClass({ padding: "none", className: "h-48 w-full" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-44 w-full" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-56 w-full" })} />
        </div>
      </div>
    </main>
  );
}
