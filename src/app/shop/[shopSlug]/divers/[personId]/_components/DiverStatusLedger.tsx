import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";
import type { DiverStatusKind, DiverStatusRow, DiverStatusTarget } from "../_lib/status";

/**
 * **The status ledger — what is open about this diver, and the one fix each.**
 *
 * The record's one idea, in the same row grammar as the home's stations (ADR
 * 20260827-people-not-lists, decision 1; the language is
 * 20260827-clearwater-surface-language). A kind word in the row's own type
 * with the tone in the ink, one sentence, one act — never a pill, never a
 * tinted panel.
 *
 * **It renders nothing when the diver is clear.** Not a heading, not an
 * "all clear" line, not an empty group: nothing. That silence is the design —
 * the first thing under the masthead is either work or the diver's story, and
 * a green box announcing an absence would spend the reader's first glance
 * saying what a blank space already says. `DiverStatusLedger.test.tsx` pins it,
 * and so does `buildDiverStatus`'s own test on the empty array that gets here.
 *
 * No coral. This is the record's warning-amber half; the record's one earned
 * moment is the line that appears *after* the last row clears
 * (`EarnedMomentLine`, in the masthead slot), which is the only accent ink
 * this page is allowed (decision 11's table).
 */

/** The word a row leads with. A kind is a word in the row's own type, never a chip. */
const KIND_WORD: Record<DiverStatusKind, StaffMessageKey> = {
  certification: "divers.status.kind.certification",
  waiver: "divers.status.kind.waiver",
  payment: "divers.status.kind.payment",
  contact: "divers.status.kind.contact",
};

/**
 * Where each fix goes. Three of the four are in-page fragments onto the
 * control that does the work — a fragment link both scrolls to and focuses a
 * focusable target, so "Verify it" lands the cursor on Verify with no
 * JavaScript at all. `collect` is the exception: an order is a page of its own
 * and stays first-class on the Orders ledger.
 */
export const STATUS_TARGET_ANCHORS: Record<Exclude<DiverStatusTarget, "collect">, string> = {
  verify: "#card-awaiting",
  send_waiver: "#waiver-send",
  edit_contact: "#edit-details",
};

function fixHref(row: DiverStatusRow, shopSlug: string): string {
  const target = row.action?.target;
  if (target === "collect") {
    return row.orderId ? `/shop/${shopSlug}/orders/${row.orderId}` : "#the-story";
  }
  return target ? STATUS_TARGET_ANCHORS[target] : "";
}

export function DiverStatusLedger({
  rows,
  t,
  locale,
  timezone,
  shopSlug,
}: {
  rows: DiverStatusRow[];
  t: StaffTranslator;
  locale: string;
  timezone: string;
  shopSlug: string;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-8" aria-label={t("divers.status.ariaLabel")}>
      {rows.map((row) => {
        const sentence =
          "blocker" in row.sentence
            ? readinessBlockerText(t, row.sentence.blocker)
            : t(row.sentence.key, row.sentence.values);
        return (
          <LedgerRow
            key={`${row.kind}-${row.tone}`}
            kind={{ word: t(KIND_WORD[row.kind]), tone: row.tone }}
            className="py-3"
            trailing={
              row.action ? (
                <Link
                  href={fixHref(row, shopSlug)}
                  // Through `buttonClass` so the 44px target is structural
                  // rather than a remembered `min-h-11` — this is the one tap
                  // the row exists for.
                  className={buttonClass({ variant: "link", size: "sm" })}
                >
                  {t(row.action.labelKey)}
                </Link>
              ) : null
            }
          >
            <p className="text-base">{sentence}</p>
            {row.tripContext ? (
              <p className="text-sm text-muted">
                {t("divers.status.onDeparture", {
                  when: `${formatShortDate(row.tripContext.startsAt, locale, timezone)} · ${formatTime(
                    row.tripContext.startsAt,
                    locale,
                    timezone,
                  )}`,
                })}
              </p>
            ) : null}
          </LedgerRow>
        );
      })}
    </ul>
  );
}
