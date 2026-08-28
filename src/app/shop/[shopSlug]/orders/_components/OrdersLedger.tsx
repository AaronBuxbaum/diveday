import { Badge, type BadgeTone } from "@/components/ui/badge";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";

/**
 * **Orders as a day ledger** — ADR 20260827-clearwater-surface-language,
 * decision 7.
 *
 * The index was a twenty-row table repeating the same two facts down every
 * row: the departure title, and the date. Eight of Wednesday's orders said
 * "Wed, Aug 26" one under the other, in a column as wide as the diver's name,
 * and the seven seats sold off one reef trip said its title seven times. That
 * is principle 9 ("say a shared fact once") enforced *within* a list and
 * violated *between* its rows.
 *
 * So the day owns its own facts. A group header carries the date, the day's
 * order count and the day's subtotal; a row is a diver, what they bought, and
 * an amount. **No row renders its group's date** — that is the rule this
 * file's test pins, and it is the reason the row's stretched-link label names
 * the diver and the amount rather than spelling the date out again in the
 * accessibility tree. The day heading is a real `h2` above the list, so a
 * screen reader still hears which day it is walking.
 *
 * Everything here is already worded and already formatted: the day label, the
 * "3 orders · $412.75" meta, the money. Staff copy is server-only and this
 * component knows nothing about locales or zones, which is also what lets its
 * test state a date once and prove it renders once.
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
          // A `<div>` and a heading, not a `<section>`: eight days on a page
          // would be eight `region` landmarks in a screen reader's landmark
          // list, which is chrome pretending to be structure. The heading is
          // what carries the day, and the list points back at it so a reader
          // entering the rows is told which day they are in.
          <div key={day.key}>
            <GroupLabel as="h2" id={labelId} meta={day.meta}>
              {day.label}
            </GroupLabel>
            {/* The gap belongs to the list, not to the label: `GroupLabel`'s
                meta shape puts the label and its facts in one flex row, so a
                padding passed through `className` would land on the words and
                not on the row they share. */}
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
          {/* The one figure on the row, and the only thing a reader scans a
              money column for: tabular, right-aligned, and set at the row
              title's weight so the eye can run down it. */}
          <span className="min-w-20 text-end text-base font-semibold tabular-nums">
            {row.amount}
          </span>
        </div>
      }
    >
      {/* The diver leads at a fixed measure so a column of names reads as a
          column; what they bought takes the rest. Below `sm` the two stack,
          because 230px of name plus a departure title plus an amount on one
          390px line leaves the title nothing to wrap in. */}
      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
        <span className="truncate text-base font-medium sm:w-56 sm:shrink-0">{row.diver}</span>
        {/* 16px on a phone and 14px from `sm` up: what a diver bought is how a
            staffer identifies the record, so it is critical text at the width
            where the row has least room (`scripts/check-critical-text.mjs`). */}
        {row.detail ? (
          <span className="truncate text-base text-muted sm:text-sm">{row.detail}</span>
        ) : null}
      </div>
    </LedgerRow>
  );
}
