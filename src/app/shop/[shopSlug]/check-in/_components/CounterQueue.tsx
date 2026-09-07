import { SettledRows } from "@/components/SettledRows";
import { LedgerGroup } from "@/components/ui/ledger";
import { RollingFigure } from "@/components/ui/RollingFigure";
import type { CheckInQueueRow as QueueRow } from "@/db/check-in";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isSettledAtCounter } from "@/lib/check-in";
import { CounterQueueRow } from "./CounterQueueRow";

/**
 * **One departure's divers: who still needs something, then who has settled** —
 * ADR 20260827-clearwater-surface-language, decision 9.
 *
 * The working list is only the people a staffer can still do something about.
 * Everyone already through sinks into one collapsed group, which is 6a's one
 * disclosure spelling (`LedgerGroup folded`, a native `<details>` under the
 * shared caret) rather than a second idiom invented here. Settled rows are
 * never interleaved with the queue: that interleaving is what made a
 * twenty-six-name morning unreadable, because the rows a staffer had to act on
 * were spread through the rows they had already dealt with.
 *
 * **Settled is checked in *and* cleared** (`isSettledAtCounter`,
 * `src/lib/check-in.ts`). A diver who came through the door and has gone
 * blocked since — a refund landing, a card corrected — is work, not a receipt,
 * and stays out here in the working list wearing their badge and their reasons.
 * Folding that row away was the counter's most dangerous silence: the manifest
 * would still refuse them at the rail, but catching it ashore while the diver
 * is standing there is this surface's entire job.
 *
 * **The group is not truncated.** It is folded at rest, which is what the
 * forty-receipts problem actually needed; slicing it to three also hid whichever
 * rows happened to sort last, and there was no control to reveal them.
 */
export function CounterQueue({
  rows,
  shopSlug,
  isAmbiguousName,
  showFirstVisit,
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
  /**
   * Whether a first visit marks anybody out on this screen at all
   * (`firstVisitMarksAnException`, `src/lib/check-in.ts`). Judged by the page
   * over the whole visible queue, never per departure: a staffer reads down the
   * page, and a word every name carries singles out nobody.
   */
  showFirstVisit: boolean;
  checkInAction: (formData: FormData) => Promise<{ ok: true }>;
  undoAction: (formData: FormData) => Promise<{ ok: true }>;
  waiverAction: (formData: FormData) => Promise<void>;
  /**
   * Open the settled group on arrival. True for a boat that has already
   * sailed, where the receipts *are* what the counter is for, and true under a
   * search, where the row somebody typed a name to reach may well be one of
   * them.
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
  const settled = rows.filter(isSettledAtCounter);
  const waiting = rows.filter((row) => !isSettledAtCounter(row));

  return (
    <>
      {waiting.length > 0 ? (
        // The rows beneath a check-in slide into its gap on the same clock the
        // row took to sink, instead of jumping (ADR
        // 20260907-nothing-from-nowhere, decision 3).
        <SettledRows>
          {waiting.map((row) => (
            <CounterQueueRow
              key={row.bookingId}
              row={row}
              shopSlug={shopSlug}
              showEmail={isAmbiguousName(row.personName)}
              showFirstVisit={showFirstVisit}
              checkInAction={checkInAction}
              undoAction={undoAction}
              waiverAction={waiverAction}
              t={t}
            />
          ))}
        </SettledRows>
      ) : null}

      {settled.length > 0 ? (
        <LedgerGroup
          as={settledHeadingLevel}
          className="mt-6"
          folded={!settledOpen}
          label={
            // The count rolls on increment, and only its digits do — the words
            // around it are the same statement (ADR
            // 20260907-nothing-from-nowhere, decision 3). It replaces a
            // keyed remount playing `fade-in` over the whole label, which
            // faded the words too and so said "this line is new" rather than
            // "this number changed". Reduced motion swaps, as it did.
            <RollingFigure className="tabular-nums">
              {t("checkIn.settledGroup", { count: settled.length })}
            </RollingFigure>
          }
        >
          <SettledRows className="opacity-70">
            {settled.map((row) => (
              <CounterQueueRow
                key={row.bookingId}
                row={row}
                shopSlug={shopSlug}
                showEmail={isAmbiguousName(row.personName)}
                showFirstVisit={showFirstVisit}
                checkInAction={checkInAction}
                undoAction={undoAction}
                waiverAction={waiverAction}
                t={t}
              />
            ))}
          </SettledRows>
        </LedgerGroup>
      ) : null}
    </>
  );
}
