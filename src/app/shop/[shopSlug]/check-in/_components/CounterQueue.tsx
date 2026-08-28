import { LedgerGroup } from "@/components/ui/ledger";
import type { CheckInQueueRow as QueueRow } from "@/db/check-in";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CounterQueueRow } from "./CounterQueueRow";

/**
 * **One departure's divers: who is still to come, then who has settled** — ADR
 * 20260827-clearwater-surface-language, decision 9.
 *
 * The working list is only the people a staffer can still do something about.
 * Everyone already through sinks into one collapsed group, which is 6a's one
 * disclosure spelling (`LedgerGroup folded`, a native `<details>` under the
 * shared caret) rather than a second idiom invented here. Settled rows are
 * never interleaved with the queue: that interleaving is what made a
 * twenty-six-name morning unreadable, because the rows a staffer had to act on
 * were spread through the rows they had already dealt with.
 *
 * **Beyond three, the group truncates to "and N more".** A settled row is a
 * receipt, and forty of them under a queue of two is the same problem again.
 * The rows that stay are the ones a mis-tap is most likely to be about; a
 * correction further down is one search away, which is the counter's primary
 * gesture anyway — a search for that diver renders their settled row in a
 * group of one, with its undo.
 */

/** How many settled rows stay visible before the group counts the rest. */
export const SETTLED_PREVIEW_COUNT = 3;

export function CounterQueue({
  rows,
  shopSlug,
  isAmbiguousName,
  checkInAction,
  undoAction,
  waiverAction,
  settledOpen,
  settledHeadingLevel,
  t,
}: {
  /** One departure's rows, in the reader's order. */
  rows: readonly QueueRow[];
  shopSlug: string;
  /** Whether two visible divers share this name — the email is a disambiguator. */
  isAmbiguousName: (personName: string) => boolean;
  checkInAction: (formData: FormData) => Promise<{ ok: true }>;
  undoAction: (formData: FormData) => Promise<{ ok: true }>;
  waiverAction: (formData: FormData) => Promise<void>;
  /**
   * Open the settled group on arrival. True for a boat that has already
   * sailed, where the receipts *are* what the counter is for.
   */
  settledOpen: boolean;
  /**
   * The heading level of the settled group's `<summary>`. The page has one
   * outline in focus mode (the departure is an `h2`) and another when a search
   * spreads results across boats (each departure an `h3`), and a skipped level
   * is an axe `heading-order` finding on a surface `e2e/a11y.spec.ts` scans.
   */
  settledHeadingLevel: "h3" | "h4";
  t: StaffTranslator;
}) {
  const waiting = rows.filter((row) => row.bookingStatus !== "checked_in");
  const settled = rows.filter((row) => row.bookingStatus === "checked_in");
  const shown = settled.slice(0, SETTLED_PREVIEW_COUNT);
  const hidden = settled.length - shown.length;

  return (
    <>
      {waiting.length > 0 ? (
        <div>
          {waiting.map((row) => (
            <CounterQueueRow
              key={row.bookingId}
              row={row}
              shopSlug={shopSlug}
              showEmail={isAmbiguousName(row.personName)}
              checkInAction={checkInAction}
              undoAction={undoAction}
              waiverAction={waiverAction}
              t={t}
            />
          ))}
        </div>
      ) : null}

      {settled.length > 0 ? (
        <LedgerGroup
          as={settledHeadingLevel}
          className="mt-6"
          folded={!settledOpen}
          label={
            // The count cross-fades on increment: a new `key` remounts the
            // span, so the existing 150ms `fade-in` plays on the number that
            // just changed and on nothing else. Reduced motion zeroes it and
            // the number alone carries the fact.
            <span key={settled.length} className="animate-fade-in">
              {t("checkIn.settledGroup", { count: settled.length })}
            </span>
          }
        >
          <div className="opacity-70">
            {shown.map((row) => (
              <CounterQueueRow
                key={row.bookingId}
                row={row}
                shopSlug={shopSlug}
                showEmail={isAmbiguousName(row.personName)}
                checkInAction={checkInAction}
                undoAction={undoAction}
                waiverAction={waiverAction}
                t={t}
              />
            ))}
            {hidden > 0 ? (
              <p className="border-t border-b border-border py-3 text-sm text-muted tabular-nums">
                {t("checkIn.settledMore", { count: hidden })}
              </p>
            ) : null}
          </div>
        </LedgerGroup>
      ) : null}
    </>
  );
}
