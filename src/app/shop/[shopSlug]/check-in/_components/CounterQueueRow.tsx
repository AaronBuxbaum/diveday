import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { BlockedDiverRow } from "@/app/shop/[shopSlug]/_components/today/BlockedDiverRow";
import { printPassAction } from "@/app/shop/[shopSlug]/print/actions";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { LedgerRow } from "@/components/ui/ledger";
import { SettledCheck } from "@/components/ui/SettledCheck";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { CheckInQueueRow as QueueRow } from "@/db/check-in";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { blockerFixFor } from "@/lib/blockers";
import type { CalendarDate } from "@/lib/calendar-date";
import { guardianSignatureRequired } from "@/lib/guardian";
import type { NoShowClaim } from "@/lib/no-show";
import type { PaperWaiverAction } from "@/lib/paper-waiver-form";
import type { FormNotice } from "@/lib/staff-notices";
import { counterBlockerDisclosure } from "../blocker-disclosure";
import { CheckInActionForm } from "../CheckInActionForm";
import { NoShowSalvage, type NoShowSalvageCopy, NoShowScript } from "./NoShowScript";

/**
 * A refused paper-waiver recording, and the booking it is about.
 *
 * `FormNotice` is the roster's shape (`form`, `tone`, `text`); `bookingId` is
 * the widening `noticeForForm` is generic in order to preserve. The page
 * resolves both and hands this down, because the words come from the staff
 * bundle at render time and only the page holds the translator's locale.
 */
export type CounterWaiverNotice = FormNotice & {
  bookingId: string;
  /**
   * The `?notice=` code itself. Only one refusal on this form has a way
   * through — a co-signer whose name reads as the diver's own (issue #1573) —
   * and the row needs to tell it from the others to draw the confirmation.
   */
  code?: string;
};

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
    // The one instruction the gift row needs, in the quiet slot the row already
    // has for a fact rather than as a second control: the diver in front of the
    // counter is checked in by the name on the seat.
    row.giftGiverName ? t("checkIn.row.giftDoor") : null,
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
        {/* **A gift nobody has claimed, on the day** (ADR 20260908-one-hand,
            decision 6, lever W). A warning rather than a neutral fact, because
            it is a thing the counter has to act on: the person standing there
            may never have opened the link, and the seat is under a name the
            giver typed. Never a boarding blocker — readiness owns that line,
            and it is already saying its own piece on this row. */}
        {row.giftGiverName ? (
          <Badge tone="warning">
            {t("checkIn.row.giftUnclaimed", { giver: row.giftGiverName })}
          </Badge>
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
  today,
  showEmail,
  showFirstVisit,
  checkInAction,
  undoAction,
  waiverAction,
  waiverNotice,
  noShowClaim,
  markNoShowAction,
  undoNoShowAction,
  salvage,
  t,
}: {
  row: QueueRow;
  shopSlug: string;
  /** The shop's own calendar day — see `CounterQueue`. */
  today: CalendarDate;
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
  /** A reducer, not a plain form action: a refused paper release answers in
   * the form, carrying the typed values back (`PaperWaiverAction`, #1674). */
  waiverAction: PaperWaiverAction;
  /**
   * The page's refused paper-waiver recording, when there is one — already
   * routed to a form by `noticeForForm` and carrying the booking it is about.
   * Rendered only on the row that booking names, which is the whole point: the
   * queue can hold three families at once (issue 1574).
   */
  waiverNotice?: CounterWaiverNotice;
  /**
   * Which "Not here?" script this row gets, or `null` for none — the page runs
   * `noShowGate` (`src/lib/no-show.ts`) over the departure and the arrivals
   * window, because it is the layer holding both, and then `noShowClaim` for
   * what the tap would be saying. The writer runs the same gate again under a
   * lock, so this decides only what is drawn.
   */
  noShowClaim: NoShowClaim | null;
  markNoShowAction: (formData: FormData) => Promise<void>;
  undoNoShowAction: (formData: FormData) => Promise<void>;
  /**
   * What the shop can do with this released seat, already worded — the page
   * holds the translator, the locale and the shop's timezone, so it is the one
   * layer that can turn `noShowSalvage`'s codes and dates into these strings.
   * Absent on every row that is not marked not here.
   */
  salvage?: NoShowSalvageCopy;
  t: StaffTranslator;
}) {
  const refusedWaiver = waiverNotice?.bookingId === row.bookingId ? waiverNotice : undefined;
  const checkedIn = row.bookingStatus === "checked_in";
  const ready = row.readiness.status === "ready";

  if (row.bookingStatus === "no_show") {
    return (
      /* **The released seat, and what to do with it** (issue #1209). A plain
         neutral badge rather than a warning: nothing has gone wrong, a staffer
         recorded a fact. The word is "Not here" — never archived, never
         deactivated — and the Undo beside it is the whole reason the row stays
         on this page instead of vanishing: the diver who walks in as the lines
         come off needs somewhere for a staffer to walk it back. */
      <LedgerRow as="article" size="lg" className="py-1">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
          <div className="min-w-0">
            <DiverIdentity
              row={row}
              showEmail={showEmail}
              showFirstVisit={showFirstVisit}
              t={t}
              name={<span className="block truncate text-base text-muted">{row.personName}</span>}
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge tone="neutral">{t("checkIn.noShow.badge")}</Badge>
            <form action={undoNoShowAction}>
              <input type="hidden" name="bookingId" value={row.bookingId} />
              <SubmitButton
                pendingLabel={t("checkIn.noShow.undoing")}
                ariaLabel={t("checkIn.noShow.undoAriaLabel", { name: row.personName })}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                {t("checkIn.noShow.undo")}
              </SubmitButton>
            </form>
          </div>
        </div>
        {salvage ? <NoShowSalvage copy={salvage} /> : null}
      </LedgerRow>
    );
  }

  if (checkedIn && ready) {
    return (
      /* **The paper pass, on the settled row and nowhere else** (ADR
         20260908-one-hand, decision 6, lever X). A pass is for the diver
         standing at the desk who has no phone, and the moment they need it is
         the one just after their name is ticked: it says which boat, where it
         leaves from and when to be there. Here rather than on the waiting row
         because the waiting row is one tap by design — the whole surface is
         built so a staffer with wet hands cannot miss it — and a second control
         beside that tap is the mis-tap this row spent a slice removing. */
      <LedgerRow as="article" size="lg" trailing={<PassDoor shopSlug={shopSlug} row={row} t={t} />}>
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
        {/* **A sibling of the tap, never inside it.** The whole row above is
            one `<button>`, so the door has to sit under it — which is also
            where it belongs: the counter's promise is a name and one large
            target, and the door is a quiet line a staffer goes looking for once
            the boat has left without somebody. */}
        {noShowClaim ? (
          <NoShowScript
            action={markNoShowAction}
            bookingId={row.bookingId}
            // **Two scripts, because the tap is two different claims**
            // (`noShowClaim`, src/lib/no-show.ts). While the boat is still
            // there the sentence is about a seat and the diver may yet come
            // running down the dock. Once it has gone the same tap says this
            // person did not dive, which is the claim seven readers spend and
            // the one nobody comes back to undo — so the door asks the louder
            // question rather than the same three quiet words.
            copy={
              noShowClaim === "did_not_dive"
                ? {
                    door: t("checkIn.noShow.sailedDoor"),
                    consequence: t("checkIn.noShow.sailedConsequence"),
                    confirm: t("checkIn.noShow.sailedConfirm"),
                    confirming: t("checkIn.noShow.confirming"),
                    confirmAriaLabel: t("checkIn.noShow.sailedConfirmAriaLabel", {
                      name: row.personName,
                    }),
                  }
                : {
                    door: t("checkIn.noShow.door"),
                    consequence: t("checkIn.noShow.consequence"),
                    confirm: t("checkIn.noShow.confirm"),
                    confirming: t("checkIn.noShow.confirming"),
                    confirmAriaLabel: t("checkIn.noShow.confirmAriaLabel", {
                      name: row.personName,
                    }),
                  }
            }
          />
        ) : null}
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
  // A diver at the counter with a signed paper release in hand: record it here
  // rather than sending them off to the trip's guest list. Offered only when
  // the waiver is the one fix this row is showing.
  const paperControl = fix?.sendsWaiver ? (
    <PaperWaiverControl
      action={waiverAction}
      bookingId={row.bookingId}
      copy={paperWaiverCopy(t, "counter")}
      // A minor's paper release names its co-signer too (ADR
      // 20260907-guardian-co-signature).
      requiresGuardian={guardianSignatureRequired(row.dateOfBirth, today)}
      // The diver is standing here, so a staffer can truthfully say they
      // watched both a namesake parent and child sign — the roster is the
      // other such door, the diver's record deliberately not one.
      offersNamesake
      // Drawn on this row's own refusal, or on a page notice that named this
      // booking, and on no other minor at the counter.
      noticedNamesake={refusedWaiver?.code === "waiver-guardian-name"}
      className="mt-2"
      // A page-level notice that landed the staffer back here re-opens the
      // form. A refused recording no longer navigates at all: it answers under
      // the button with what they typed still in the boxes (issue #1674).
      defaultOpen={Boolean(refusedWaiver)}
    />
  ) : null;
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
        surface="check_in"
        waiverCopy={waiverSendCopy(t)}
        blockers={row.readiness.blockers}
        fix={fix}
        collapseReasons={counterBlockerDisclosure(t, row.readiness.blockers) ?? undefined}
        t={t}
        extra={
          // **The message is not nested inside the control**, and that is the
          // whole correctness of it. `blockerFixFor` offers one fix, so a diver
          // held back by four things at once may not be offered the paper
          // control at all — and the first shape of this put the refusal inside
          // that branch, so the page banner stepped aside for a row that then
          // said nothing. Measured against the dev server, not reasoned about:
          // `?notice=…` alone rendered the banner, `?notice=…&bid=…` rendered
          // neither (issue 1574).
          //
          // `BlockedDiverRow` renders `extra` unconditionally in both layouts,
          // so a refusal routed to a rendered row always has somewhere to land.
          refusedWaiver ? (
            <div className="min-w-0">
              {paperControl}
              <FormStatus tone={refusedWaiver.tone} className="mt-2">
                {refusedWaiver.text}
              </FormStatus>
            </div>
          ) : (
            // Unwrapped when nothing was refused, so every ordinary row keeps
            // the exact flex child it had before this change.
            paperControl
          )
        }
      />
    </LedgerRow>
  );
}

/**
 * A form rather than a link, because printing a pass records that the shop
 * printed one — the Print register's own fact (`shop_print_runs`). It carries
 * the booking, and the register keeps only the day.
 */
function PassDoor({ shopSlug, row, t }: { shopSlug: string; row: QueueRow; t: StaffTranslator }) {
  return (
    <form action={printPassAction}>
      <input type="hidden" name="shopSlug" value={shopSlug} />
      <input type="hidden" name="bookingId" value={row.bookingId} />
      <SubmitButton
        pendingLabel={t("print.counter.passDoor")}
        ariaLabel={t("print.counter.passDoor")}
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        {t("print.counter.passDoor")}
      </SubmitButton>
    </form>
  );
}
