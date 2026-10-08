import { SectionCard } from "@/components/ui/card";
import { LedgerRow } from "@/components/ui/ledger";
import type { WorkOrderEvent } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { workOrderStatusLabel } from "@/i18n/work-order-labels";
import { formatShortDate } from "@/lib/format";
import type { WorkOrderOutcome, WorkOrderSubject } from "@/lib/work-orders";

export type WorkOrderHistoryEvent = WorkOrderEvent & {
  actorName: string | null;
  technicianName: string | null;
};

/**
 * **How the ticket got here**: one row per act, oldest first, each with the
 * day and the staffer who made it.
 *
 * Append-only and never edited, which is the point — "who said this was ready
 * on Tuesday" is a question a shop gets asked, and the answer has to be the
 * record rather than somebody's memory. Ordered by the row's own sequence, not
 * its timestamp, so two acts in the same second read in the order they
 * happened.
 */
export function WorkOrderHistoryCard({
  events,
  subject,
  outcome,
  locale,
  timezone,
  t,
}: {
  events: WorkOrderHistoryEvent[];
  /** Whose ticket, and how it ended: a shop unit's last move reads in its own words. */
  subject: WorkOrderSubject;
  outcome: WorkOrderOutcome | null;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  return (
    <SectionCard title={t("workOrders.detail.historyHeading")} padding="lg">
      <ul>
        {events.map((event) => (
          <LedgerRow as="li" key={event.id}>
            <span className="flex min-w-0 flex-col gap-1">
              <span>{historyLine(event, subject, outcome, t)}</span>
              <span className="text-muted text-xs">
                {[
                  formatShortDate(event.createdAt, locale, timezone),
                  event.actorName ? t("workOrders.history.by", { name: event.actorName }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </LedgerRow>
        ))}
      </ul>
    </SectionCard>
  );
}

/** One history row's sentence, in the ticket's own vocabulary. */
function historyLine(
  event: WorkOrderHistoryEvent,
  subject: WorkOrderSubject,
  outcome: WorkOrderOutcome | null,
  t: StaffTranslator,
): string {
  if (event.kind === "created") return t("workOrders.history.created");
  if (event.kind === "work_recorded") return t("workOrders.history.workRecorded");
  if (event.kind === "technician_assigned") {
    return event.technicianName
      ? t("workOrders.history.handedTo", { name: event.technicianName })
      : t("workOrders.history.takenOff");
  }
  const { fromStatus, toStatus } = event;
  // A status row with half a move is not a sentence; the only row that can
  // lack a `from` is the opening one, which says so in its own words.
  if (!fromStatus || !toStatus) return t("workOrders.history.created");
  return t("workOrders.history.moved", {
    from: workOrderStatusLabel(t, fromStatus, subject, outcome),
    to: workOrderStatusLabel(t, toStatus, subject, outcome),
  });
}
