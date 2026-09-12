import { SettledRows } from "@/components/SettledRows";
import { LedgerGroup } from "@/components/ui/ledger";
import { RollingFigure } from "@/components/ui/RollingFigure";
import type { CheckInQueueRow as QueueRow } from "@/db/check-in";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import { counterIsDone, isNoShowAtCounter, isSettledAtCounter } from "@/lib/check-in";
import type { NoShowClaim } from "@/lib/no-show";
import { CounterQueueRow, type CounterWaiverNotice } from "./CounterQueueRow";
import type { NoShowSalvageCopy } from "./NoShowScript";

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
  today,
  isAmbiguousName,
  showFirstVisit,
  checkInAction,
  undoAction,
  waiverAction,
  waiverNotice,
  noShowClaimFor,
  markNoShowAction,
  undoNoShowAction,
  salvageFor,
  settledOpen,
  settledHeadingLevel,
  t,
}: {
  /** One departure's rows, in the reader's order. */
  rows: readonly QueueRow[];
  shopSlug: string;
  /**
   * The shop's own calendar day, which is the day a paper release recorded
   * here is signed on — and so the day the guardian rule measures a diver's
   * age against (ADR 20260907-guardian-co-signature).
   */
  today: CalendarDate;
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
   * A refused paper-waiver recording, passed straight through: the row it
   * names is the one that renders it, and every other row ignores it. Handed
   * to both groups rather than only the working one — a refusal leaves the row
   * blocked, so it is never settled today, and a prop that quietly depended on
   * that would be a trap for whoever changes `isSettledAtCounter`.
   */
  waiverNotice?: CounterWaiverNotice;
  /**
   * Which "Not here?" script this row gets, or `null` for no door at all — the
   * page runs `noShowGate` and, when it opens, `noShowClaim`.
   */
  noShowClaimFor: (row: QueueRow) => NoShowClaim | null;
  markNoShowAction: (formData: FormData) => Promise<void>;
  undoNoShowAction: (formData: FormData) => Promise<void>;
  /** What the shop can do with a released seat, already worded by the page. */
  salvageFor: (row: QueueRow) => NoShowSalvageCopy | undefined;
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
  const notHere = rows.filter(isNoShowAtCounter);
  const waiting = rows.filter((row) => !counterIsDone(row));

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
              today={today}
              showEmail={isAmbiguousName(row.personName)}
              showFirstVisit={showFirstVisit}
              checkInAction={checkInAction}
              undoAction={undoAction}
              waiverAction={waiverAction}
              waiverNotice={waiverNotice}
              noShowClaim={noShowClaimFor(row)}
              markNoShowAction={markNoShowAction}
              undoNoShowAction={undoNoShowAction}
              salvage={salvageFor(row)}
              t={t}
            />
          ))}
        </SettledRows>
      ) : null}

      {notHere.length > 0 ? (
        // **Its own group, and never folded** (issue #1209). The receipts group
        // below is folded because a checked-in diver is finished; a released
        // seat is the opposite — it is the one thing on this screen with work
        // still attached to it, and the panel under each row says who that work
        // could go to. Folding it would hide the whole point of the mark one
        // tap after making it.
        //
        // Not merged into the settled group either: "Checked in — 4" over a row
        // that says "Not here" is a group header that lies about its own rows.
        <LedgerGroup
          as={settledHeadingLevel}
          className="mt-6"
          label={t("checkIn.noShow.group", { count: notHere.length })}
        >
          <SettledRows>
            {notHere.map((row) => (
              <CounterQueueRow
                key={row.bookingId}
                row={row}
                shopSlug={shopSlug}
                today={today}
                showEmail={isAmbiguousName(row.personName)}
                showFirstVisit={showFirstVisit}
                checkInAction={checkInAction}
                undoAction={undoAction}
                waiverAction={waiverAction}
                waiverNotice={waiverNotice}
                noShowClaim={noShowClaimFor(row)}
                markNoShowAction={markNoShowAction}
                undoNoShowAction={undoNoShowAction}
                salvage={salvageFor(row)}
                t={t}
              />
            ))}
          </SettledRows>
        </LedgerGroup>
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
                today={today}
                showEmail={isAmbiguousName(row.personName)}
                showFirstVisit={showFirstVisit}
                checkInAction={checkInAction}
                undoAction={undoAction}
                waiverAction={waiverAction}
                waiverNotice={waiverNotice}
                noShowClaim={noShowClaimFor(row)}
                markNoShowAction={markNoShowAction}
                undoNoShowAction={undoNoShowAction}
                salvage={salvageFor(row)}
                t={t}
              />
            ))}
          </SettledRows>
        </LedgerGroup>
      ) : null}
    </>
  );
}
