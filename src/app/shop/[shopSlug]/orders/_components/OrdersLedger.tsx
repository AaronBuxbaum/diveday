import { Badge, type BadgeTone } from "@/components/ui/badge";
import { GroupLabel } from "@/components/ui/group-label";
import { LedgerRow } from "@/components/ui/ledger";

/**
 * The day heading supplies the date, count and subtotal; row text and accessible
 * names omit the date. Values arrive translated and formatted (ADR
 * 20260827-clearwater-surface-language, decision 7).
 */

export type OrderLedgerRow = {
  /** The order id — React's key, and nothing else. */
  id: string;
  /** The order record. The whole row is a stretched link to it. */
  href: string;
  /**
   * The stretched link's accessible name. The diver and the amount — never the
   * date, which the group heading above already carries.
   */
  linkLabel: string;
  diver: string;
  /**
   * What was bought: the departure title, or the order's own description for a
   * counter sale. Muted, one line, and never the date.
   */
  detail: string | null;
  /**
   * Only when the status is exceptional. A settled order renders nothing here
   * — "Paid" on 45 of 50 rows is the expected state formatted as information
   * (principle 9), and `Badge` is the only pill on the page.
   */
  status: { word: string; tone: BadgeTone } | null;
  /**
   * How money taken at the counter was taken ("Cash", "Card machine"), already
   * worded; absent for a Stripe invoice, which is the ordinary case (ADR
   * 20261009-counter-payments). Quiet text beside the amount, never a badge.
   */
  method?: string | null;
  /** Already formatted in the order's own stored currency. */
  amount: string;
};

export type OrderLedgerDay = {
  /** The shop-local calendar day — a key and a fragment id, never rendered. */
  key: string;
  /** The whole day header line, already worded ("Today · Thu, Aug 27"). */
  label: string;
  /** The facts the day owns for its rows ("3 orders · $412.75"). Tabular. */
  meta: string;
  rows: readonly OrderLedgerRow[];
};

export function OrdersLedger({
  days,
  className = "",
}: {
  days: readonly OrderLedgerDay[];
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-9 ${className}`.trim()}>
      {days.map((day) => {
        const labelId = `orders-day-${day.key}`;
        return (
          // Name the list by its day heading without adding a landmark.
          <div key={day.key}>
            <GroupLabel as="h2" id={labelId} meta={day.meta}>
              {day.label}
            </GroupLabel>
            {/* Keep spacing on the list so it separates rows from GroupLabel's
                combined label-and-facts line. */}
            <ul aria-labelledby={labelId} className="mt-2.5 flex flex-col">
              {day.rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Row({ row }: { row: OrderLedgerRow }) {
  return (
    <LedgerRow
      href={row.href}
      linkLabel={row.linkLabel}
      trailing={
        <div className="flex items-center gap-3">
          {row.status ? (
            <Badge tone={row.status.tone} size="sm">
              {row.status.word}
            </Badge>
          ) : null}
          {row.method ? <span className="text-sm text-muted">{row.method}</span> : null}
          {/* The row's sole scan figure: tabular and right-aligned. */}
          <span className="min-w-20 text-end text-base font-semibold tabular-nums">
            {row.amount}
          </span>
        </div>
      }
    >
      {/* Align names at a fixed measure on wider screens; stack name and title
          on phones so both remain readable beside the amount. */}
      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
        <span className="truncate text-base font-medium sm:w-56 sm:shrink-0">{row.diver}</span>
        {/* Critical text stays 16px on phones (`scripts/check-critical-text.mjs`).
            Titles wrap there so shared departure prefixes remain distinguishable;
            from `sm` up they truncate on one line to keep row height stable. */}
        {row.detail ? (
          <span className="text-base text-muted text-pretty sm:truncate sm:text-sm">
            {row.detail}
          </span>
        ) : null}
      </div>
    </LedgerRow>
  );
}
