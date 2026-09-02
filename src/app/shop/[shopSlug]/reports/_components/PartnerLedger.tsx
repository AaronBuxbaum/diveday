import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";

/**
 * **Who sent the shop divers this month** — one row per partner whose referral
 * link a booking arrived on, biggest first (issue #1285).
 *
 * The embed generator has always been able to hand a hotel an attributed link;
 * until now nothing read the attribution back, so the fact existed only in a
 * URL nobody kept. This is where it lands: the shop's own slug for its own
 * link, and the seats it accounts for.
 *
 * **Nothing at all when nobody was credited**, which is every shop that has not
 * handed a partner link out — not an empty state, not a heading over a blank.
 * A group label only ever appears over rows, and a report that grew a permanent
 * "no partners" section would describe a month by what did not happen in it.
 *
 * Counted on the same basis as the seats figure above (active bookings, live
 * departures, this month), so the two reconcile: these rows are a slice of that
 * number, never a second one. The unattributed remainder has no row of its own —
 * this list answers "who sends us divers", and the divers nobody sent are the
 * difference between two figures already on the page.
 */
export function PartnerLedger({
  label,
  labelId,
  rows,
  seatsWord,
  className = "",
}: {
  label: string;
  labelId: string;
  rows: { partner: string; seats: number }[];
  /** "6 seats", already pluralised and localised by the caller. */
  seatsWord: (seats: number) => string;
  className?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <LedgerGroup as="h2" id={labelId} label={label} className={className}>
      <ul aria-labelledby={labelId} className="mt-3">
        {rows.map((row) => (
          <LedgerRow
            key={row.partner}
            // The slug, as the shop's generator wrote it. Deliberately not
            // prettified back into a name: DiveDay never learned the name, only
            // the slug, and inventing capitals for one would claim otherwise.
            trailing={
              <span className="text-sm text-muted tabular-nums">{seatsWord(row.seats)}</span>
            }
          >
            {row.partner}
          </LedgerRow>
        ))}
      </ul>
    </LedgerGroup>
  );
}
