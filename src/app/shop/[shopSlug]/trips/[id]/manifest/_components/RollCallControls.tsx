import {
  type RollCallAction,
  RollCallButton,
  type RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isNotBackAboard, type RollCallCheckpoint, type RollCallRecord } from "@/lib/manifests";

// Shared structure for every roll-call button below (design/forms-and-controls.md's
// dock target, `buttonClass({ size: "boat" })`'s min-h-14, plus the boat-mode press
// feedback) — kept as one constant here so the four state variants below can't
// drift out of sync with each other the way two separate call sites once did.
export const BOAT_TARGET_CLASS =
  "flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg px-5 text-base font-semibold transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70";

/**
 * One fill per roll-call state, shared by the diver rows and the crew rows so
 * the two lists can never disagree about what a colour means.
 *
 * The two *recorded* outcomes have to be told apart across a wet deck in
 * sunlight, which is why they are different hues rather than two washes of the
 * same one: aboard is green, left ashore is amber. They used to be `success/10`
 * and a plain slate `surface-sunken`, two pale neutrals that read as the same
 * card at arm's length. Awaiting takes the slate instead — nothing has been
 * said about that person yet.
 *
 * **Only one row on this page wears a ring**, and it is the one that means a
 * person is in the water. "Left ashore" is a *settled* outcome — the glossary
 * calls it benign and genuinely accounted for — so it gets the hue that
 * separates it from green and none of the alarm that separates red from
 * everything: a ringed amber sitting beside a ringed red reads as the same
 * class of emergency at arm's length in glare, and it would make the most
 * closed row on the page louder than `awaiting`, which is the state that still
 * needs a human (dive-domain review 20260804).
 *
 * Colour never carries this alone: every row states its status in words, on the
 * button beside it on screen and on the pill beside the name in print.
 */
export const ROLL_CALL_ROW_TONE = {
  /** A stated "did not come back" — the loudest thing on the page, and the only ring. */
  notBackAboard: "border-danger bg-danger/15 ring-1 ring-danger/40",
  boarded: "border-success bg-success/20",
  notBoarded: "border-warning bg-warning/15",
  /** Carried forward from the dock rather than recorded here — same hue, quieter. */
  notBoardedImplied: "border-dashed border-warning/60 bg-warning/5",
  awaiting: "border-border-strong bg-surface-sunken",
  /** Awaiting *and* blocked: readiness is the thing to fix before boarding. */
  blocked: "border-danger bg-danger/5",
} as const;

/**
 * What one roll-call record means at one checkpoint, as the booleans every row
 * on this page asks for.
 *
 * **One derivation, three readers.** The diver list, the crew list, and the
 * button stack below each rebuilt these from `rollCall` by hand, and the four
 * lines were subtly different in each — which is precisely the shape of the
 * bug that once printed a green-checked "Not boarded ✓" beside a diver who had
 * not come back from dive one (DOM-H3). A row's *own* extras (a diver's
 * readiness fallback, the scroll-margin the missing row wears) stay at the call
 * site; what a roll-call record means does not.
 */
export type RollCallRowState = {
  /** A human recorded this person aboard here. */
  boarded: boolean;
  /**
   * A result staff recorded at *this* checkpoint, either way round. An implied
   * not-boarded is carried forward from the dock, so it is not one — nothing
   * there is undoable and no note attaches to it.
   */
  recordedNotBoarded: boolean;
  /** Recorded not-boarded, and it means "never left the dock", not "did not come back". */
  explicitNotBoarded: boolean;
  /** Carried forward from the dock rather than said here. */
  impliedNotBoarded: boolean;
  /** After a dive: a human said they did not return to the boat (DOM-H3). */
  notBackAboard: boolean;
  /** Whether a human has said anything about this person *at this checkpoint*. */
  recordedHere: boolean;
};

export function rollCallRowState(
  checkpoint: RollCallCheckpoint,
  rollCall: Pick<RollCallRecord, "state" | "implied"> | undefined,
): RollCallRowState {
  const rc = rollCall;
  const recordedNotBoarded = rc?.state === "not_boarded" && rc.implied !== true;
  const notBackAboard = isNotBackAboard(checkpoint, rc);
  return {
    boarded: rc?.state === "boarded",
    recordedNotBoarded,
    explicitNotBoarded: recordedNotBoarded && !notBackAboard,
    impliedNotBoarded: rc?.state === "not_boarded" && rc.implied === true,
    notBackAboard,
    recordedHere: !!rc && !rc.implied,
  };
}

/**
 * The fill a *recorded* result wears, in the one order both lists read it —
 * a stated "did not come back" outranks everything, then aboard, then the two
 * flavours of ashore. `null` means nothing has been recorded here, and the
 * caller decides what an untouched row looks like (a diver's depends on
 * readiness at the dock; a crew member's never does).
 */
export function rollCallRecordedTone(
  state: RollCallRowState,
): keyof typeof ROLL_CALL_ROW_TONE | null {
  if (state.notBackAboard) return "notBackAboard";
  if (state.boarded) return "boarded";
  if (state.explicitNotBoarded) return "notBoarded";
  if (state.impliedNotBoarded) return "notBoardedImplied";
  return null;
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
  formId,
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
   * Form id, so a drafted roll-call note with no result to auto-save to yet can
   * ride the "not boarded" submit. Divers only — crew rows take no note.
   */
  formId?: string;
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
                ? t("trips.manifest.crewAboardCheck")
                : t("trips.manifest.crewMarkAboard")
              : boarded
                ? t("trips.manifest.boardedCheck")
                : t("trips.manifest.markBoarded")
          }
          pendingLabel={
            isCrew
              ? t("trips.manifest.saving")
              : boarded
                ? t("trips.manifest.undoing")
                : t("trips.manifest.boarding")
          }
          className={`${BOAT_TARGET_CLASS} ${
            boarded
              ? "border border-success bg-success/15 text-success"
              : "bg-primary text-primary-foreground hover:bg-primary-hover"
          }`}
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
                ? t("trips.manifest.crewNotAboardCheck")
                : t("trips.manifest.notBoardedCheck")
              : isCrew
                ? t("trips.manifest.crewNotBackAboardActive")
                : t("trips.manifest.notBackAboardActive")
            : isDeparture
              ? isCrew
                ? t("trips.manifest.crewMarkNotAboard")
                : t("trips.manifest.markNotBoarded")
              : isCrew
                ? t("trips.manifest.crewMarkNotBackAboard")
                : t("trips.manifest.markNotBackAboard")
        }
        pendingLabel={t("trips.manifest.saving")}
        formId={formId}
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
      {recordedHere ? (
        // The undo hint names the control it means. A not-back-aboard
        // result deliberately carries no done-check, so the generic
        // "tap the ✓ status again" would point at nothing on screen.
        //
        // Crew rows get it too. Re-tap is the app's one undo model for a
        // high-frequency toggle (design/principles.md §7), and it works
        // identically here — hiding the hint for crew taught the deck that
        // a mis-tap on a divemaster was permanent, which is exactly the
        // wrong lesson on the half of the roll call that closes the
        // checkpoint.
        <p className="text-sm text-muted">
          {notBackAboard
            ? t("trips.manifest.tapToUndoNotBackAboard")
            : t("trips.manifest.tapToUndo")}
        </p>
      ) : null}
    </div>
  );
}
