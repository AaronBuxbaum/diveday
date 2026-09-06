import Link from "next/link";
import { RentalFitKeepControl } from "@/app/shop/[shopSlug]/_components/today/RentalFitKeepControl";
import { closeDayAction, setLeftoverDecisionAction } from "@/app/shop/[shopSlug]/actions";
import { EARNED_MOMENT_SURFACE } from "@/components/EarnedMoment";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel, LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { DayCloseoutRecord } from "@/db/closeout";
import {
  CLOSEOUT_ADMIN_STATUS_KEYS,
  CLOSEOUT_DECISION_KEYS,
  CLOSEOUT_STATUS_KEYS,
} from "@/i18n/closeout-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ACTION_KIND_KEYS } from "@/i18n/today-labels";
import { formatTime } from "@/lib/format";
import { ACTION_KIND_META, type TodayAction } from "@/lib/today";

/**
 * **The closing block** — what stands beneath the spine once every departure
 * of the shop day has settled (ADR 20260827-clearwater-surface-language,
 * decision 4, and H-62, which folded `/close-out` into this).
 *
 * Two things, in this order, and nothing else: **the leftovers**, each row
 * carrying its own Dismiss, and **the one closing act**. Then the spine's own
 * Tomorrow disclosure closes the page — which is why there is no tomorrow band
 * here. A second rendering of tomorrow, twenty pixels under the first, is the
 * repetition this whole language was written against.
 *
 * Three things it deliberately does **not** have:
 *
 * - **An acknowledgement gate.** The surface it replaced made a staffer tick
 *   "I have seen the open head count" before it would record the close. H-57
 *   had already decided that leftovers are dismissed per row, immediately,
 *   with Undo — so the checkbox re-asked a decision already made, on an act
 *   that appends rather than destroys. A confirm on a reversible act is what
 *   principle 7 refuses, and `closeDay` no longer has an input for one.
 * - **A caption under the act.** "Closing is a record, not a lock" explained a
 *   mechanism nobody doubted, above a button that says what it does.
 * - **A per-row explanation of what carrying means.** The group label owns
 *   that fact for every row beneath it (decision 2), so a row is its kind, its
 *   sentence, its fix and its Dismiss.
 *
 * Rendering at all is the pin: {@link ClosingBlock} is mounted only when
 * `assembleEveningClose(...).closing` is true, which is every departure of the
 * shop day settled, with the standing one-hour late-arrival buffer. While one
 * boat is out there is nothing here to find.
 */
export function ClosingBlock({
  leftovers,
  latest,
  closeCount,
  locale,
  timeZone,
  t,
}: {
  /** Today's open rows, already stripped of the ones the shop dismissed. */
  leftovers: readonly TodayAction[];
  /** The most recent recorded close of this day, or null while it is open. */
  latest: DayCloseoutRecord | null;
  closeCount: number;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const outstanding = latest
    ? latest.outstanding.departures.length > 0 ||
      latest.outstanding.leftovers.length > 0 ||
      latest.outstanding.adminTasks.length > 0
    : false;

  return (
    // The anchor the command palette's "Close the day" lands on: the phrase
    // still answers, it just answers with a place on this page instead of a
    // destination of its own.
    <section id="close-day" aria-labelledby="close-day-label" className="scroll-mt-24">
      <GroupLabel as="h2" id="close-day-label">
        {t("closeout.close.heading")}
      </GroupLabel>

      {latest ? (
        <div
          // **The joy vocabulary, not the feedback one** (issue 761): closing a
          // day where everybody is home is the ritual principle 3 rations
          // `--accent` for, and the record it leaves is that moment recorded.
          // A coral box listing an unreconciled head count would be the panel
          // contradicting its own contents, so that branch stays flat.
          className={`mt-3 p-5 sm:p-6 ${
            outstanding
              ? "rounded-panel border border-border bg-surface shadow-bed"
              : EARNED_MOMENT_SURFACE
          }`}
        >
          <p className="font-semibold">
            {t("closeout.record.closedBy", {
              name: latest.actorName,
              time: formatTime(latest.closedAt, locale, timeZone),
            })}
          </p>
          {closeCount > 1 ? (
            <p className="mt-1 text-sm text-muted">
              {t("closeout.record.closeCount", { count: closeCount })}
            </p>
          ) : null}
          {outstanding ? null : (
            // The panel is coral, so the state it carries is said in words
            // too: a reader who cannot see the accent still learns that the
            // day closed with nothing left open.
            <p className="mt-1 text-sm text-muted">{t("closeout.record.nothingOutstanding")}</p>
          )}
          {outstanding ? (
            <div className="mt-3">
              <GroupLabel as="h4">{t("closeout.record.outstandingHeading")}</GroupLabel>
              <ul className="mt-2 space-y-1 text-sm">
                {latest.outstanding.departures.map((departure) => (
                  <li key={`dep-${departure.tripId}`}>
                    <span className="font-medium">{departure.title}</span>{" "}
                    <span className="text-muted">
                      — {t(CLOSEOUT_STATUS_KEYS[departure.status])}
                    </span>
                  </li>
                ))}
                {latest.outstanding.leftovers.map((leftover) => (
                  <li key={`left-${leftover.id}`}>
                    <span className="font-medium">{leftover.subject}</span>{" "}
                    <span className="text-muted">
                      — {t(CLOSEOUT_DECISION_KEYS[leftover.decision])}
                    </span>
                  </li>
                ))}
                {latest.outstanding.adminTasks.map((task) => (
                  <li key={`admin-${task.id}`}>
                    <span className="font-medium">{t("closeout.admin.postDiveReports.label")}</span>{" "}
                    <span className="text-muted">
                      — {t(CLOSEOUT_ADMIN_STATUS_KEYS[task.status])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The leftovers survive the close, and so does the act: closing is a
          record, never a lock (ADR 20260804-day-closeout), so a day that has
          been closed still hands back everything it was closed over. */}
      {leftovers.length > 0 ? (
        <LedgerGroup as="h3" label={t("closeout.leftovers.groupLabel")} className="mt-6">
          <ul className="mt-3">
            {leftovers.map((action) => (
              <LedgerRow
                key={action.id}
                stacked
                kind={{
                  word: t(ACTION_KIND_KEYS[action.kind]),
                  tone: ACTION_KIND_META[action.kind].tone,
                }}
                trailing={
                  <div className="flex items-center gap-2">
                    {/* Two real controls, both visible, neither stretched over
                        the row: a leftover's fix and its dismissal are
                        different answers to the same row, and a stretched
                        overlay would make one of them the accident. */}
                    {action.rentalFit ? (
                      // **The one row whose fix is the tap itself** (issue
                      // #1174, D14): the size is already known, so pointing at
                      // the diver's record to retype it would be the surface
                      // asking a question it can answer. Dismiss stays beside
                      // it, which is the other honest answer.
                      <RentalFitKeepControl
                        personId={action.rentalFit.personId}
                        kind={action.rentalFit.kind}
                        size={action.rentalFit.size}
                        label={t("today.gear.fitConfirmKeep")}
                        pendingLabel={t("today.gear.fitConfirmSaving")}
                      />
                    ) : (
                      <Link
                        href={action.href}
                        className={buttonClass({ variant: "link", size: "sm" })}
                      >
                        {action.actionLabel}
                      </Link>
                    )}
                    <form action={setLeftoverDecisionAction.bind(null, action.id, "dismiss")}>
                      <SubmitButton
                        pendingLabel={t("closeout.leftovers.saving")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                        observabilityAction="closeout-leftover-decision"
                      >
                        {t("closeout.leftovers.dismiss")}
                      </SubmitButton>
                    </form>
                  </div>
                }
              >
                <div className="min-w-0 py-2">
                  <p className="text-sm font-medium">{action.subject}</p>
                  <p className="text-sm text-muted">{action.detail}</p>
                </div>
              </LedgerRow>
            ))}
          </ul>
        </LedgerGroup>
      ) : null}

      <form action={closeDayAction} className="mt-6">
        <SubmitButton
          pendingLabel={t("closeout.close.button")}
          className={buttonClass()}
          observabilityAction="close-out"
        >
          {latest ? t("closeout.close.buttonAgain") : t("closeout.close.button")}
        </SubmitButton>
      </form>
    </section>
  );
}
