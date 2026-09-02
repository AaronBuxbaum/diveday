import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { BlockedDiverRow } from "@/app/shop/[shopSlug]/_components/today/BlockedDiverRow";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { Badge } from "@/components/ui/badge";
import { tapTargetLinkClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import { SettledCheck } from "@/components/ui/SettledCheck";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { CheckInQueueRow as QueueRow } from "@/db/check-in";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { blockerFixFor } from "@/lib/blockers";
import { counterBlockerDisclosure } from "../blocker-disclosure";
import { CheckInActionForm } from "../CheckInActionForm";

/**
 * **One diver at the counter** — ADR 20260827-clearwater-surface-language,
 * decision 9. The counter inherits the manifest's instrument language ashore:
 * a row at rest is a name and one large tap, a blocked row is a name and its
 * one fix, and a settled row is a drawn mark that has already sunk out of the
 * working list.
 *
 * Three rules this file exists to hold, all of which a hand-rolled row has
 * broken before:
 *
 * - **A blocked row never carries a check-in control.** Readiness is the gate;
 *   offering the tap beside the reasons would be offering an act the server
 *   will refuse. The fix is the only control on the row. That holds for a diver
 *   who has *already* checked in and gone blocked since: the row keeps its
 *   drawn mark so nobody re-asks them for a card they handed over, wears the
 *   Blocked badge and every reason, and offers the fix rather than an undo —
 *   un-checking somebody does not clear a blocker, and their arrival is a fact
 *   that happened.
 * - **The tap is unchanged.** `CheckInActionForm` and `QueueRowButton` still
 *   own the optimistic swap, the re-tap undo and the row-local failure
 *   message; this file composes them and asks them for nothing new. The
 *   sinking row's `fade-out` rides `has-[button:disabled]` — a CSS reading of
 *   the pending state the button already publishes — so the motion is added
 *   without the mutation learning about it.
 * - **A colour-carried state also carries a word.** The blocked badge says
 *   "Blocked", the settled mark says "Checked in", the contact gap says so in
 *   a neutral badge. The tinted row fills the counter used to wear retire with
 *   the card stack (decision 2): hairlines and ink, not eight fills.
 */

/** The row's leading identity block — name, exceptional badges, quiet meta. */
function DiverIdentity({
  row,
  name,
  showEmail,
  showFirstVisit,
  t,
}: {
  row: QueueRow;
  name: React.ReactNode;
  showEmail: boolean;
  showFirstVisit: boolean;
  t: StaffTranslator;
}) {
  const meta = [
    showEmail && row.email ? row.email : null,
    // **Quiet text, never a badge.** A badge marks an exceptional state
    // somebody has to act on; a first visit is a fact a staffer can be warmer
    // for, and boxing it would put it at the same volume as "Blocked".
    //
    // And only where it marks somebody out — `firstVisitMarksAnException`
    // (`src/lib/check-in.ts`). On a shop's first season everybody is a first
    // visit, and a line under all nine names is nine rows taller for nothing.
    row.firstVisit && showFirstVisit ? t("checkIn.row.firstVisit") : null,
  ].filter((part): part is string => Boolean(part));
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {name}
        {/* The check-in queue's own description promises this split — check-in
            is arrival, boarding is confirmed on the manifest. */}
        {row.boarded ? <Badge tone="primary">{t("checkIn.boardedBadge")}</Badge> : null}
        {/* Never a boarding blocker, and worded as the gap rather than as an
            instruction: the diver is standing right there, which is the one
            moment in the day when asking costs nothing. */}
        {row.missingEmergencyContact ? (
          <Badge tone="neutral">{t("checkIn.row.missingEmergencyContact")}</Badge>
        ) : null}
      </span>
      {meta.length > 0 ? (
        <span className="mt-0.5 block truncate text-sm text-muted">{meta.join(" · ")}</span>
      ) : null}
    </>
  );
}

export function CounterQueueRow({
  row,
  shopSlug,
  showEmail,
  showFirstVisit,
  checkInAction,
  undoAction,
  waiverAction,
  t,
}: {
  row: QueueRow;
  shopSlug: string;
  /** Only where two visible divers share a name — see the page's own note. */
  showEmail: boolean;
  /**
   * Only where a first visit marks somebody out from the rest of the visible
   * queue (`firstVisitMarksAnException`, `src/lib/check-in.ts`). The page owns
   * the judgement, because the scope it is judged over is the whole screen.
   */
  showFirstVisit: boolean;
  checkInAction: (formData: FormData) => Promise<{ ok: true }>;
  undoAction: (formData: FormData) => Promise<{ ok: true }>;
  waiverAction: (formData: FormData) => Promise<void>;
  t: StaffTranslator;
}) {
  const checkedIn = row.bookingStatus === "checked_in";
  const ready = row.readiness.status === "ready";

  if (checkedIn && ready) {
    return (
      <LedgerRow as="article" size="lg">
        <CheckInActionForm
          action={undoAction}
          bookingId={row.bookingId}
          sendFailedLabel={t("checkIn.sendFailed")}
          ariaLabel={t("checkIn.undoAriaLabel", { name: row.personName })}
          className="hover:bg-surface-sunken/60"
          trailing={
            // The drawn mark, not an emoji (ADR 20260827's accessibility
            // commitments). Its own `settle-in` deliberately stays silent
            // here: the row arrives newly mounted in the settled group, so
            // `SettledCheck`'s first-paint guard sees a mark that was always
            // settled. The motion of this moment is the row's fade-out sink.
            <SettledCheck settled label={t("checkIn.checkedInCheck")} className="text-sm" />
          }
          pendingTrailing={
            <span className="text-sm font-medium whitespace-nowrap text-muted">
              {t("checkIn.undoing")}
            </span>
          }
        >
          {/* **A settled row still says who this is.** It carried the bare name
              for one release, which quietly dropped the Boarded badge from the
              case that actually happens — boarding is recorded at the rail
              *after* the counter, so `boarded && checked_in` is the ordinary
              path (task 149) — along with the contact gap and the first visit.
              At the rail it also left the undo sitting on a row that no longer
              said the diver was aboard, which is the one fact a crew member
              correcting a mis-tap needs. Muted name: the row has sunk, it has
              not gone silent. */}
          <DiverIdentity
            row={row}
            showEmail={showEmail}
            showFirstVisit={showFirstVisit}
            t={t}
            name={<span className="block truncate text-base text-muted">{row.personName}</span>}
          />
        </CheckInActionForm>
      </LedgerRow>
    );
  }

  if (ready) {
    return (
      <LedgerRow
        as="article"
        size="lg"
        // **The sink, in CSS.** `QueueRowButton` disables itself while the tap
        // is in flight, so the row can play the existing `fade-out` (150ms,
        // `--ease-in-soft` — an exit, so the exit curve) off that one fact
        // without `CheckInActionForm` learning anything new. State moves
        // immediately underneath: the animation gates nothing, and the e2e
        // waits for the settled group's text rather than for motion. Under
        // reduced motion the kill-switch zeroes it and the regroup is instant.
        className="has-[button:disabled]:animate-fade-out"
      >
        <CheckInActionForm
          action={checkInAction}
          bookingId={row.bookingId}
          sendFailedLabel={t("checkIn.sendFailed")}
          ariaLabel={t("checkIn.checkInAriaLabel", { name: row.personName })}
          className="hover:bg-surface-sunken/60"
          trailing={
            <span className="flex items-center gap-2 text-base font-semibold whitespace-nowrap text-primary">
              {t("checkIn.checkInButton")}
              {/* The empty half of the roll-call check: a circle waiting to be
                  ticked, so the row reads as a checklist line, not a link. */}
              <span className="size-6 rounded-full border-2 border-current" />
            </span>
          }
          pendingTrailing={
            // The circle stays put while the word changes, so the row's right
            // edge never jumps on the one interaction this surface repeats.
            <span className="flex items-center gap-2 text-base font-semibold whitespace-nowrap text-muted">
              {t("checkIn.checkingIn")}
              <span className="size-6 rounded-full border-2 border-current opacity-40" />
            </span>
          }
        >
          <DiverIdentity
            row={row}
            showEmail={showEmail}
            showFirstVisit={showFirstVisit}
            t={t}
            name={<span className={`block truncate ${SECTION_TITLE_CLASS}`}>{row.personName}</span>}
          />
        </CheckInActionForm>
      </LedgerRow>
    );
  }

  const fix = blockerFixFor(
    row.readiness.blockers,
    {
      shopSlug,
      tripId: row.tripId,
      personId: row.personId,
      bookingId: row.bookingId,
      fullName: row.personName,
    },
    t,
  );
  return (
    <LedgerRow as="article" size="lg" className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <DiverIdentity
            row={row}
            showEmail={showEmail}
            showFirstVisit={showFirstVisit}
            t={t}
            name={
              // Only the blocked row keeps a name link — its job is the fix,
              // and the diver's record is one of the doors. Primary ink at
              // rest: on a phone there is no hover, and an invisible link is
              // no door at all.
              <Link
                href={`/shop/${shopSlug}/divers/${row.personId}`}
                className={`${tapTargetLinkClass} truncate ${SECTION_TITLE_CLASS} text-primary hover:underline`}
              >
                {row.personName}
              </Link>
            }
          />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Already through the counter, and blocked since. The mark is the
              same one the settled group wears, so the row says both facts in
              the vocabulary the surface already speaks: this diver arrived,
              and they still cannot board. */}
          {checkedIn ? (
            <SettledCheck settled label={t("checkIn.checkedInCheck")} className="text-sm" />
          ) : null}
          {/* The one readiness vocabulary and tone (src/i18n/readiness-labels.ts)
              — for a blocked diver the badge is the state. */}
          <Badge tone={readinessStatusTone(row.readiness.status)}>
            {readinessStatusText(t, row.readiness.status)}
          </Badge>
        </div>
      </div>
      {/* The one blocked-diver presentation, shared with the by-departure view.
          It shows *every* blocker; a single sayable reason sits open on the row
          and the rest name their first one in the summary (#759, #890). */}
      <BlockedDiverRow
        layout="below"
        shopSlug={shopSlug}
        surface="check_in"
        waiverCopy={waiverSendCopy(t)}
        blockers={row.readiness.blockers}
        fix={fix}
        collapseReasons={counterBlockerDisclosure(t, row.readiness.blockers) ?? undefined}
        t={t}
        extra={
          // A diver at the counter with a signed paper release in hand: record
          // it here rather than sending them off to the trip's guest list.
          fix?.sendsWaiver ? (
            <PaperWaiverControl
              action={waiverAction}
              bookingId={row.bookingId}
              copy={paperWaiverCopy(t)}
              className="mt-2"
            />
          ) : null
        }
      />
    </LedgerRow>
  );
}
