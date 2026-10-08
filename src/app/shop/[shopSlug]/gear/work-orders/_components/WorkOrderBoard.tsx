import { Badge } from "@/components/ui/badge";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { WorkOrderBoardGroup } from "@/db/work-orders";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { workOrderStatusLabel, workOrderStatusTone } from "@/i18n/work-order-labels";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatMoneyCents } from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";

/**
 * **The bench, grouped by where each ticket is** (ADR 20261008-gear-work-orders).
 *
 * The register's instrument pattern, applied to work orders: the group
 * heading *is* the status, so a row never repeats it, and each row says the
 * three things a counter is asked at the phone — whose it is, what is wrong
 * with it, and whether it is late. Open groups come first in counter order and
 * the collected ones last.
 *
 * A Server Component: staff copy never crosses to the client.
 */
export function WorkOrderBoard({
  groups,
  shopSlug,
  t,
  locale,
  currency,
}: {
  groups: readonly WorkOrderBoardGroup[];
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  currency: ShopCurrency;
}) {
  return (
    <div className="mt-4 flex flex-col gap-9">
      {groups.map((group) => {
        const headingId = `work-orders-${group.status}`;
        return (
          <LedgerGroup
            key={group.status}
            as="h2"
            id={headingId}
            label={t("workOrders.board.group", {
              label: workOrderStatusLabel(t, group.status),
              count: group.rows.length,
            })}
          >
            <ul aria-labelledby={headingId}>
              {group.rows.map((row) => (
                <LedgerRow
                  key={row.id}
                  href={`/shop/${shopSlug}/gear/work-orders/${row.id}`}
                  linkLabel={t("workOrders.board.rowLink", {
                    subject: row.personName ?? row.gearItemLabel ?? "",
                    problem: row.reportedProblem,
                  })}
                  trailing={
                    row.totalCents > 0 ? (
                      <span className="tabular-nums text-muted text-sm">
                        {formatMoneyCents(row.totalCents, currency, locale)}
                      </span>
                    ) : null
                  }
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium">{row.personName ?? row.gearItemLabel}</span>
                      {row.late ? <Badge tone="warning">{t("workOrders.board.late")}</Badge> : null}
                      {row.status === "ready" ? (
                        <Badge tone={workOrderStatusTone(row.status)}>
                          {workOrderStatusLabel(t, row.status)}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="min-w-0 text-muted text-sm">{row.reportedProblem}</span>
                    <span className="text-muted text-xs">
                      {[
                        row.gearItemId
                          ? t("workOrders.board.ownUnit")
                          : t("workOrders.board.pieces", { count: row.pieceCount }),
                        row.technicianName
                          ? t("workOrders.board.with", { name: row.technicianName })
                          : t("workOrders.board.unassigned"),
                        row.promisedOn
                          ? t("workOrders.board.promised", {
                              date: formatCalendarDate(row.promisedOn, locale),
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </LedgerRow>
              ))}
            </ul>
          </LedgerGroup>
        );
      })}
    </div>
  );
}
