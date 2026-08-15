import {
  type RollCallAction,
  RollCallButton,
  type RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type RollCallCheckpoint, type RollCallRecord, rollCallRowState } from "@/lib/manifests";

/**
 * Shared structure for every roll-call button below: the dock target
 * (design/forms-and-controls.md), coloured per row state at the call sites.
 *
 * It used to be a literal class string, and its own comment named the API it
 * was bypassing — `buttonClass({ size: "boat" })`. Three other surfaces had
 * copied that literal, and all four had drifted apart on padding, press
 * scale, and disabled opacity; none of them carried the `cursor-pointer` that
 * Tailwind v4's Preflight removed from `<button>`. `variant: "bare"` is the
 * gap that made copying easier than importing: the shape and the touch target,
 * with the fill left to the row.
 */
export const BOAT_TARGET_CLASS = buttonClass({
  variant: "bare",
  size: "boat",
  // These disable themselves for the moment their own submit is in flight.
  busy: true,
  className: "w-full",
});

/**
 * What one roll-call record means at one checkpoint, and the fill a recorded
 * result wears — both re-exported from the domain layer, where they moved so
 * the offline boat-mode manifest could stop keeping its own copy.
 *
 * `src/components/OfflineManifestView.tsx` is the fourth reader, and it may
 * not import from `src/app` (`pnpm check:architecture`) — which is why it had
 * a copy at all, and why that copy had drifted into painting an *awaiting*
 * diver amber with a ring, the two marks reserved for "left ashore" and "did
 * not come back". Re-exported here because this file is where every roll-call
 * consumer on this page already looks.
 */
export {
  type RollCallRecordedTone,
  type RollCallRowState,
  rollCallRecordedTone,
  rollCallRowState,
} from "@/lib/manifests";
/**
 * The fills themselves live in the shared row-tone vocabulary
 * (`src/components/row-tones.ts`), beside the counter queue's quieter map —
 * one module so the two surfaces a staffer reads minutes apart can never
 * drift into two meanings for one colour. Re-exported here because this file
 * is where every roll-call consumer already looks for them.
 */
export { ROLL_CALL_ROW_TONE };

/**
 * The scroll margin every roll-call row wears, diver and crew alike.
 *
 * Both lists are jump targets — the summary panel's chips link to any uncalled
 * person — and both sit under the same sticky checkpoint panel, so the margin
 * that keeps a name clear of it is one fact, not two. It lived in `DiverRollCall`
 * alone until crew rows became jump targets too (FU-20260810); duplicating the
 * two magic numbers would mean a future change to the panel's height silently
 * fixing one list and not the other.
 *
 * Sized to the panel at its tallest for the checkpoint kind: after a dive it can
 * carry up to three pinned danger lines. A jump that buries the name under the
 * panel is what invites a tap on the *next* visible row's button, for the wrong
 * person (dive-domain review 20260810) — which is why this is bounded by the
 * panel rather than by taste.
 */
export function rollCallScrollMargin(isDeparture: boolean): string {
  return isDeparture ? "scroll-mt-64" : "scroll-mt-80";
}

/**
 * The two-button stack a roll-call row carries: "aboard" on top, "not
 * boarded" / "not back aboard" below it.
 *
 * **One component for divers and crew.** The two lists differ only in the
 * subject they name (a booking vs. a `people.id`), the words on the buttons,
 * and whether the boarding control is shown at all — everything that is
 * *safety* behaviour is the same, and used to be written twice: the
 * checkpoint-dependent "not back aboard" wording (DOM-H3), the fill per
 * recorded state, the remount-on-checkpoint `key` contract, and the rule that
 * a not-back-aboard result never settles into a done-check. Two copies is how
 * a green-checked "Not boarded ✓" appeared beside a diver who had not come
 * back from dive one; this is the one place it can be fixed.
 */
export function RollCallControls({
  kind,
  subjectId,
  checkpoint,
  isDeparture,
  rollCall,
  action,
  copy,
  showBoardControl,
  noteDraftFor,
  t,
}: {
  /** Which list this row belongs to — the only thing that varies below. */
  kind: "diver" | "crew";
  /** A `bookings.id` for a diver, a `people.id` for a crew member. */
  subjectId: string;
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
  rollCall: RollCallRecord | undefined;
  action: RollCallAction;
  copy: RollCallButtonCopy;
  /**
   * Divers only board at departure once readiness clears them (`ready ||
   * !isDeparture`); crew carry no readiness, so their control is always shown.
   */
  showBoardControl: boolean;
  /**
   * The row whose unsaved note draft both buttons should carry, so a note
   * typed before anybody was called rides whichever result lands — boarded or
   * not. Divers only; crew rows take no note.
   */
  noteDraftFor?: { bookingId: string; checkpoint: string };
  t: StaffTranslator;
}) {
  const { boarded, recordedNotBoarded, notBackAboard, recordedHere } = rollCallRowState(
    checkpoint,
    rollCall,
  );
  const isCrew = kind === "crew";
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 print:hidden sm:w-56">
      {showBoardControl ? (
        <RollCallButton
          // Forces a remount — and a fresh `useActionState` `result` — on
          // every checkpoint switch (see the component's own doc comment);
          // this route/key is otherwise identical across checkpoints, so
          // without it a refusal from one checkpoint can survive into
          // another and misattribute.
          key={isCrew ? `crew-aboard-${checkpoint}` : `board-${checkpoint}`}
          action={action}
          subject={
            isCrew ? { field: "personId", id: subjectId } : { field: "bookingId", id: subjectId }
          }
          status={boarded ? "cleared" : "boarded"}
          label={
            isCrew
              ? boarded
                ? t("manifest.crewAboardCheck")
                : t("manifest.crewMarkAboard")
              : boarded
                ? t("manifest.boardedCheck")
                : t("manifest.markBoarded")
          }
          pendingLabel={
            isCrew ? t("manifest.saving") : boarded ? t("manifest.undoing") : t("manifest.boarding")
          }
          className={`${BOAT_TARGET_CLASS} ${
            boarded
              ? "border border-success bg-success/15 text-success"
              : "bg-primary text-primary-foreground hover:bg-primary-hover"
          }`}
          noteDraftFor={noteDraftFor}
          copy={copy}
        />
      ) : null}
      {/* The exception control. Most people board, so while nothing has been
          recorded and the board button is on offer, this drops the border and
          fill — the exception at less than equal weight (design principle 8),
          still a full dock-test target. Foreground ink, not muted: marking a
          no-show is a routine dock act on the surface with the harshest
          viewing conditions, so it demotes by losing its box, never its
          legibility (dive-domain review 20260810). It takes the bordered
          treatment back the moment it matters: when it is the only control on
          the row (a blocked diver at departure), or when it carries the
          recorded state (the settled "Not boarded ☑️", the danger-tinted
          "Not back aboard"). After a dive the unrecorded label keeps danger
          ink — it is the control that reports a person missing, and it must
          be findable at the rail without reading every word. */}
      <RollCallButton
        // Same remount-on-checkpoint reasoning as the board button above.
        key={isCrew ? `crew-not-aboard-${checkpoint}` : `not-boarded-${checkpoint}`}
        action={action}
        subject={
          isCrew ? { field: "personId", id: subjectId } : { field: "bookingId", id: subjectId }
        }
        status={recordedNotBoarded ? "cleared" : "not_boarded"}
        // The worst string in the change was a green-checked "Not
        // boarded ✓" beside a diver who had not come back from dive
        // one. After a dive this control is "not back aboard" and
        // its recorded state never carries a done-check (DOM-H3).
        label={
          recordedNotBoarded
            ? isDeparture
              ? isCrew
                ? t("manifest.crewNotAboardCheck")
                : t("manifest.notBoardedCheck")
              : isCrew
                ? t("manifest.crewNotBackAboardActive")
                : t("manifest.notBackAboardActive")
            : isDeparture
              ? isCrew
                ? t("manifest.crewMarkNotAboard")
                : t("manifest.markNotBoarded")
              : isCrew
                ? t("manifest.crewMarkNotBackAboard")
                : t("manifest.markNotBackAboard")
        }
        pendingLabel={t("manifest.saving")}
        noteDraftFor={noteDraftFor}
        className={
          notBackAboard
            ? `${BOAT_TARGET_CLASS} border border-danger bg-danger/15 text-danger`
            : recordedNotBoarded
              ? `${BOAT_TARGET_CLASS} border border-border-strong bg-surface-sunken`
              : showBoardControl
                ? isDeparture
                  ? `${BOAT_TARGET_CLASS} hover:bg-surface-sunken`
                  : `${BOAT_TARGET_CLASS} text-danger hover:bg-danger/10`
                : `${BOAT_TARGET_CLASS} border border-border hover:bg-surface-sunken`
        }
        copy={copy}
      />
      {/* One row state still says how to take it back, and only one.
          Everywhere else the settled control speaks for itself: a button
          reading "Boarded ☑️" that you just tapped into that state is its own
          affordance, and the sentence under it was a line of chrome per
          settled row teaching a grammar the deck already has.
          "Not back aboard" is the exception, and stays. It carries no
          done-check — nothing about it reads as a toggle — and it is the
          highest-consequence state on the page to leave wrong: a crew member
          who spots that row 4 is wrong after rattling through nine names must
          not read a danger-toned button as a claim they cannot undo. Several
          at once is an emergency, not repetitive chrome (dive-domain review
          20260811).
          Crew rows get it on the same terms — re-tap is the app's one undo
          model for a high-frequency toggle (design/principles.md §7), and
          hiding it for crew taught the deck that a mis-tap on a divemaster
          was permanent. */}
      {recordedHere && notBackAboard ? (
        <p className="text-sm text-muted">{t("manifest.tapToUndoNotBackAboard")}</p>
      ) : null}
    </div>
  );
}
