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
 * The same dock target at `px-4` instead of the boat size's `px-6` — for the
 * exception control while it sits *beside* an on-offer board button. The pair
 * shares one row, and on a 390px phone the eight horizontal-padding pixels per
 * side are exactly what decides whether "Mark not boarded" fits next to "Mark
 * boarded" or wraps the pair into a stack. Same 56px height, same 16px label;
 * only the box around the words narrows. `flush` + an explicit `px-4` because
 * a `px-4` passed on top of the size's `px-6` is silently inert — spacing
 * utilities resolve by emitted order, not call-site order (see button.ts).
 */
const BOAT_TARGET_COMPACT_CLASS = buttonClass({
  variant: "bare",
  size: "boat",
  busy: true,
  flush: true,
  className: "w-full px-4",
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
 * The one quiet-disclosure grammar every roll-call row's rare path wears —
 * a diver's "Contact & gear" / "Add a private note" pair and a crew member's
 * single "Emergency contact" line. Shared here rather than left for
 * `CrewRollCall.tsx` to retype: the two lists used to carry two copies of
 * this exact class string (a Sourcery review on PR #607 caught the second),
 * and a future retouch — the caret's rotation, the panel's tint — now has one
 * place to land rather than two that can quietly drift apart.
 *
 * Only the summary and panel treatment live here. The *grid* that pairs a
 * diver's two disclosures side by side (`sm:grid-cols-2`) stays put in
 * `DiverRollCall.tsx` — crew get one disclosure, not two, so there is no
 * grid to share.
 */
export const ROW_DISCLOSURE_SUMMARY_CLASS =
  "group/summary flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-base font-medium text-muted select-none hover:text-primary [&::-webkit-details-marker]:hidden";
export const ROW_DISCLOSURE_PANEL_CLASS =
  "mb-1 rounded-xl border border-border/70 bg-surface-sunken/50 p-3";

/**
 * Where each control sits in the cluster's flex-wrap row, and how wide it
 * claims — the "which slot, how wide" half of the layout `RollCallControls`
 * draws below. Named here rather than left as a bare literal at each call
 * site (a Sourcery review on PR #607 asked for exactly this): the cluster's
 * three shapes — the affirmative, the exception paired beside it, the
 * exception alone as the row's only control — are one thing to read and one
 * thing to change together, not three picked apart from memory at three
 * scattered `formClassName` props.
 *
 * This is a *within-this-file* consolidation, not a cross-surface one:
 * `src/components/OfflineManifestView.tsx` hand-rolls its own equivalent
 * buttons rather than importing `RollCallControls` itself, because
 * `src/components` may not import from `src/app`
 * (`pnpm check:architecture`) — the same boundary that makes `BOAT_TARGET_CLASS`
 * above a re-derivation, not a shared import, in that file. Moving the
 * cluster's layout (not just its fill) out to a location both sides can
 * reach is a real architectural change, not a rename, and stays a follow-up
 * rather than riding in in a review-response pass.
 */
const AFFIRMATIVE_FORM_CLASS = "w-full md:order-2 md:w-48";
const EXCEPTION_FORM_CLASS_PAIRED = "w-full md:order-1 md:w-auto";
const EXCEPTION_FORM_CLASS_ALONE = "w-full md:w-auto md:min-w-48";

/**
 * The control cluster a roll-call row carries: one line, the affirmative
 * ("aboard") at the row's end and the exception ("not boarded" / "not back
 * aboard") beside it.
 *
 * It was a vertical stack of two full-width controls — which, times ten rows,
 * made the page's dominant visual element the buttons rather than the people,
 * and spent a filled-primary rectangle on every awaiting row (ten primaries on
 * one screen, against principle 8's one). The affirmative now wears a
 * primary-bordered quiet face until it is tapped; the moment it records, the
 * row's own green fill and the settled "Boarded ☑️" carry the state. The
 * exception keeps exactly the demotion logic it had — boxless beside an
 * on-offer board control, bordered when settled or alone, danger ink after a
 * dive — just sitting beside the affirmative instead of under it.
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
  // On a phone the pair stacks full-width, affirmative on top — the biggest
  // possible wet-hands targets, in the order of the acts. From `md` the pair
  // sits on one line beside the name, the affirmative at the row's end where
  // every settled row's state lands (`md:order-*` swaps them visually; the
  // affirmative stays first in the DOM so keyboard and reader order lead with
  // the act the row is for). Deliberately not one line on the phone: the es-ES
  // labels are wider than half a 390px row, so a shared line either wraps a
  // label mid-word or squeezes the board button below its own text. The
  // refusal/undo lines carry `basis-full order-3` and drop below the pair.
  return (
    <div className="flex w-full shrink-0 flex-wrap items-stretch gap-2 print:hidden md:w-auto md:justify-end">
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
          // Once boarded, the visible ☑️ and the row's own green fill are the
          // re-tap affordance for a sighted user — neither reaches a screen
          // reader, so the accessible name says the same thing in words
          // (CodeRabbit review, PR #607). Unset while unrecorded: "Mark
          // boarded"/"Mark aboard" already read as an action, not a state.
          ariaLabel={
            boarded
              ? isCrew
                ? t("manifest.crewAboardCheckAriaLabel")
                : t("manifest.boardedCheckAriaLabel")
              : undefined
          }
          pendingLabel={
            isCrew ? t("manifest.saving") : boarded ? t("manifest.undoing") : t("manifest.boarding")
          }
          // Unrecorded wears the primary *border*, not the primary fill: the
          // fill spent the page's one primary weight ten times over, and the
          // real celebration is the row turning green when the tap lands.
          className={`${BOAT_TARGET_CLASS} ${
            boarded
              ? "border border-success bg-success/15 text-success"
              : "border border-primary bg-surface text-primary hover:bg-primary-tint"
          }`}
          formClassName={AFFIRMATIVE_FORM_CLASS}
          noteDraftFor={noteDraftFor}
          copy={copy}
          observabilityAction={isCrew ? "roll-call-crew" : "roll-call-diver"}
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
        // Only the departure ☑️ states get a words-say-it-too accessible name.
        // "Not back aboard" is principle 7's one *visible* exception — it
        // already carries its own on-screen undo sentence just below the
        // pair, which a screen reader reaches in the same forward read, so
        // duplicating it into the accessible name would say it twice.
        ariaLabel={
          recordedNotBoarded && isDeparture
            ? isCrew
              ? t("manifest.crewNotAboardCheckAriaLabel")
              : t("manifest.notBoardedCheckAriaLabel")
            : undefined
        }
        pendingLabel={t("manifest.saving")}
        noteDraftFor={noteDraftFor}
        className={
          notBackAboard
            ? `${showBoardControl ? BOAT_TARGET_COMPACT_CLASS : BOAT_TARGET_CLASS} border border-danger bg-danger/15 text-danger`
            : recordedNotBoarded
              ? `${showBoardControl ? BOAT_TARGET_COMPACT_CLASS : BOAT_TARGET_CLASS} border border-border-strong bg-surface-sunken`
              : showBoardControl
                ? isDeparture
                  ? `${BOAT_TARGET_COMPACT_CLASS} hover:bg-surface-sunken`
                  : `${BOAT_TARGET_COMPACT_CLASS} text-danger hover:bg-danger-tint`
                : `${BOAT_TARGET_CLASS} border border-border hover:bg-surface-sunken`
        }
        formClassName={showBoardControl ? EXCEPTION_FORM_CLASS_PAIRED : EXCEPTION_FORM_CLASS_ALONE}
        copy={copy}
        observabilityAction={isCrew ? "roll-call-crew" : "roll-call-diver"}
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
        <p className="order-3 basis-full text-sm text-muted md:text-right">
          {t("manifest.tapToUndoNotBackAboard")}
        </p>
      ) : null}
    </div>
  );
}
