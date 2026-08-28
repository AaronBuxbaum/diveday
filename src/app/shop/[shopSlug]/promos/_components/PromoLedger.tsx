import type { ReactNode } from "react";
import { Copyable } from "@/components/Copyable";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { PromoLedgerGroup } from "@/lib/promo-codes";

/**
 * **The shop's codes as one ledger, shelved by window** — ADR
 * 20260827-the-shops-shelves, decision 1 and its mapping table ("one page, two
 * ledgers"), in the open-ledger grammar of ADR
 * 20260827-clearwater-surface-language.
 *
 * What this replaced was a stack of bordered cards, one per code, each
 * carrying a status pill that mostly said "Live" — a badge on the expected
 * state, which is the exact reading decision 3 retires. Whether a code is
 * working now, has not started, or is over is a fact a whole run of them
 * shares, so it moved to the group header and said itself once. The badge that
 * remains marks what is genuinely exceptional about *one* code: Stripe never
 * created it, the mint never finished, or the shop switched it off.
 *
 * Two rules, both pinned in `PromoLedger.test.tsx`:
 *
 * - **The rows arrive shelved and are never re-shelved here.**
 *   `listShopPromoCodes` sorts group-major so a shelf cannot interleave across
 *   a page boundary, and `promoLedgerGroup` decides which shelf. This walks
 *   consecutive runs, exactly as the course roster does — a component that
 *   bucketed into a map and read the keys back would silently hide a broken
 *   sort and reorder the codes inside each shelf.
 * - **No group carries a count.** The page has one Pager over all three
 *   shelves, and a per-group tally would count *this page's* rows while
 *   reading as the shelf's size — a number that changes when you turn the page
 *   and never says so.
 */

/** One code, already worded by the page — this file formats nothing. */
export type PromoCodeRow = {
  id: string;
  /** Which shelf the query put it on. The run, not a re-derivation. */
  group: PromoLedgerGroup;
  code: string;
  /** "10% off", pre-formatted. */
  discount: string;
  /**
   * The one exceptional thing about this code — never its window, which the
   * group header owns. Absent for a code with nothing exceptional to say.
   */
  badge?: { tone: BadgeTone; word: string };
  /** The shop's own note about the code. Their words, so never assumed present. */
  description?: string | null;
  /** "Trips and courses · from Aug 1 · no end date · Redeemed 1 time". Pre-formatted. */
  facts: string;
  /** Switch off/on, or retry and delete — the caller's forms, per its permissions. */
  actions?: ReactNode;
};

/** One shelf's run of codes, in the order the rows arrived. */
export type PromoCodeLedgerGroup = { group: PromoLedgerGroup; rows: PromoCodeRow[] };

/**
 * Consecutive runs of one shelf, never a re-shelve. A change of group *is* the
 * boundary, so a query that stopped sorting group-major would draw the same
 * shelf twice rather than quietly gathering rows out of their creation order.
 */
export function groupPromoRows(rows: readonly PromoCodeRow[]): PromoCodeLedgerGroup[] {
  const groups: PromoCodeLedgerGroup[] = [];
  for (const row of rows) {
    const open = groups.at(-1);
    if (open && open.group === row.group) open.rows.push(row);
    else groups.push({ group: row.group, rows: [row] });
  }
  return groups;
}

export function PromoCodeLedger({
  rows,
  labels,
  copy,
  className = "",
}: {
  rows: readonly PromoCodeRow[];
  /** The shelf words, from the staff bundle. */
  labels: Record<PromoLedgerGroup, string>;
  /** The copy-to-clipboard control's three words. */
  copy: { copyLabel: string; copiedLabel: string; failedLabel: string };
  className?: string;
}) {
  return (
    <div className={`space-y-8 ${className}`.trim()}>
      {groupPromoRows(rows).map((group, index) => {
        // A shelf that resumes on a later page gets the same heading again,
        // so the id has to be unique within the page rather than per shelf.
        const labelId = `promo-shelf-${group.group}-${index}`;
        return (
          <LedgerGroup key={labelId} as="h2" id={labelId} label={labels[group.group]}>
            <ul aria-labelledby={labelId} className="mt-2">
              {group.rows.map((row) => (
                <LedgerRow key={row.id} trailing={row.actions} className="py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono font-semibold">{row.code}</span>
                      <Copyable
                        layout="inline"
                        value={row.code}
                        copyLabel={copy.copyLabel}
                        copiedLabel={copy.copiedLabel}
                        failedLabel={copy.failedLabel}
                      />
                      <span className="text-sm font-medium text-primary tabular-nums">
                        {row.discount}
                      </span>
                      {row.badge ? (
                        <Badge tone={row.badge.tone} size="sm">
                          {row.badge.word}
                        </Badge>
                      ) : null}
                    </p>
                    {row.description ? (
                      <p className="mt-0.5 text-sm text-muted">{row.description}</p>
                    ) : null}
                    <p className="mt-0.5 text-sm text-muted tabular-nums">{row.facts}</p>
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

/** One outstanding last-minute deal, already worded. */
export type TripDealRow = {
  id: string;
  code: string;
  discount: string;
  /** The departure the deal was sent from. The row is the door to it. */
  tripTitle: string;
  href: string;
  /** "Expires Fri, Aug 28, 6:00 PM · Sent to 9 divers". Pre-formatted. */
  facts: string;
};

/**
 * The one-trip deals, their own ledger beneath the codes — the ADR's mapping
 * table keeps them separate on purpose. A deal is sent from a departure and
 * dies with it; a code belongs to the shop. They page independently
 * (`?dealsPage=`), which is the other reason they are two ledgers rather than
 * a fourth shelf of one.
 *
 * The heading is the page's, not this component's: the section has an empty
 * state as well as a list, and both stand under the same words. A heading
 * rendered here would be a second spelling of it for the branch that has rows.
 */
export function TripDealLedger({
  rows,
  labelledBy,
  className = "",
}: {
  rows: readonly TripDealRow[];
  /** The id of the page's own heading for this section. */
  labelledBy: string;
  className?: string;
}) {
  return (
    <ul aria-labelledby={labelledBy} className={className || undefined}>
      {rows.map((row) => (
        <LedgerRow key={row.id} href={row.href} linkLabel={row.tripTitle} className="py-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono font-semibold">{row.code}</span>
              <span className="text-sm font-medium text-primary tabular-nums">{row.discount}</span>
              <span className="font-medium">{row.tripTitle}</span>
            </p>
            <p className="mt-0.5 text-sm text-muted tabular-nums">{row.facts}</p>
          </div>
        </LedgerRow>
      ))}
    </ul>
  );
}
