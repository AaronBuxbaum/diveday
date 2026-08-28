import {
  type RollCallAction,
  RollCallButton,
  type RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { RollCallMark, type RollCallMarkState } from "@/components/RollCallMark";
import { ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  ROLL_CALL_NOTE_MAX,
  type RollCallCheckpoint,
  type RollCallRecord,
  type RollCallRowState,
  rollCallRowState,
} from "@/lib/manifests";

/**
 * **The manifest's two roll-call gestures, and why they are two components.**
 *
 * ADR 20260827-the-departure-is-two-working-surfaces, decision 3 —
 * *consequence decides the gesture*:
 *
 * - **Aboard is a plain tap**, on the row's trailing edge, undone by tapping it
 *   again. It is the high-frequency act — ten of them per checkpoint per
 *   departure — and getting it wrong costs one more tap.
 * - **Not back is a deliberate two-step**, recorded from the person's own
 *   panel. It is the highest-consequence claim this app can make, it happens a
 *   handful of times a year, and it must be impossible to brush past with a wet
 *   thumb on a moving boat.
 *
 * The two used to sit side by side in one cluster, two 56px targets a
 * thumb-width apart, and the destructive one was the *wider* of the pair on a
 * 390px phone. Splitting them is the whole point: `RollCallMarkButton` is what
 * a row carries at rest, `RollCallExceptionControl` and
 * `RollCallBackAboardControl` may only be rendered inside a person's opened
 * panel, and `DiverRollCall.test.tsx` / `CrewRollCall.test.tsx` fail if either
 * becomes reachable in one tap from the list again.
 *
 * Everything that is *safety* behaviour still lives in one place — the shared
 * `RollCallButton` underneath both: the instant pending state, the
 * server-authoritative confirm, the `role="alert"` refusal, and the
 * remount-on-checkpoint key contract.
 */

/**
 * Shared structure for the exception control below: the dock target
 * (design/forms-and-controls.md), coloured per row state at the call site.
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
 * The affirmative tap itself: a bare 56px circle, no box, no label text. The
 * `RollCallMark` inside it is the drawn state and the button's accessible name
 * is the words, so nothing is carried by colour alone (decision 5).
 */
const MARK_BUTTON_CLASS = buttonClass({
  variant: "bare",
  size: "mark",
  busy: true,
  className: "rounded-full",
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
 * person — and both sit under the same sticky count panel, so the margin that
 * keeps a name clear of it is one fact, not two. It lived in `DiverRollCall`
 * alone until crew rows became jump targets too (FU-20260810); duplicating the
 * two magic numbers would mean a future change to the panel's height silently
 * fixing one list and not the other.
 *
 * Sized to the panel at its tallest for the checkpoint kind: after a dive it can
 * carry up to three pinned danger lines. A jump that buries the name under the
 * panel is what invites a tap on the *next* visible row's mark, for the wrong
 * person (dive-domain review 20260810) — which is why this is bounded by the
 * panel rather than by taste.
 */
export function rollCallScrollMargin(isDeparture: boolean): string {
  return isDeparture ? "scroll-mt-64" : "scroll-mt-80";
}

/**
 * The person row's disclosure: the whole name column is the summary, and one
 * tap opens everything the rail does not need this second — contact, gear,
 * medical, notes, the readiness blockers and their fix, and the exception
 * control (ADR 20260827-the-departure-is-two-working-surfaces, decision 2's
 * "one tap away" tier).
 *
 * `list-none` and the webkit marker reset because the row draws its own caret
 * at the trailing edge; `min-h-19` is the 76px row the canvas measures, which
 * keeps a 56px mark centred beside it with room above and below.
 *
 * **A real gap separates it from the mark**, and it belongs to the mark's own
 * container (`ps-3` at the call sites) rather than to this padding — padding is
 * *inside* a hit box, so `pe-*` here would still be summary-clickable and buy
 * nothing. The two targets are adjacent and do opposite things: one opens a
 * person, one records a result. With their boxes touching, a tap that lands a
 * few pixels off the mark opens the panel instead — which grows the row and
 * moves every name below it, so the crew member's *next* tap, aimed by memory
 * at where a name was, is now over somebody else's mark (a design review of
 * slice 5a called this the worst mis-tap on the surface).
 *
 * Everything else on the line is measured against what is left for the name at
 * 390px: `gap-2.5` and a `size-7` index, because "Kiona Blackfeather" at 18px
 * semibold wants 165px and the column has 176 to give it. A name that wraps
 * pushes its own audit line down and makes every row a different height, which
 * is the one thing a list read at a glance cannot afford.
 */
export const ROW_DISCLOSURE_SUMMARY_CLASS =
  "group/summary flex min-h-19 w-full cursor-pointer list-none items-center gap-2.5 py-3 ps-4 pe-2 select-none [&::-webkit-details-marker]:hidden";
export const ROW_DISCLOSURE_PANEL_CLASS =
  "mx-4 mb-4 rounded-xl border border-border/70 bg-surface-sunken/50 p-3";

/**
 * Which drawn mark a row wears, from the same row state every other reader
 * derives. `held` is dock-only by construction: readiness gates boarding at
 * the dock and never after a dive, so a blocked diver mid-count is an ordinary
 * "to call" like anyone else.
 */
export function rollCallMarkState(
  state: RollCallRowState,
  { blockedAtDock = false }: { blockedAtDock?: boolean } = {},
): RollCallMarkState {
  if (state.notBackAboard) return "notBack";
  if (state.boarded) return "aboard";
  if (state.recordedNotBoarded || state.impliedNotBoarded) return "ashore";
  return blockedAtDock ? "held" : "toCall";
}

/**
 * The one tap a roll-call row carries at rest.
 *
 * **The glyph is the state; the tap is the act.** A row already aboard undoes
 * itself on a re-tap (the app's one undo model for a high-frequency toggle,
 * design/principles.md §7); an untouched or ashore row moves to aboard.
 *
 * **Two rows carry no tap at all**, and both are deliberate:
 *
 * - a diver blocked at the dock, whose row shows a static held ring, because
 *   the act that clears them is ashore on the Trip tab (`showBoardControl` at
 *   the call sites);
 * - a person recorded **not back aboard**, whose acts both live in their panel.
 *   ADR 20260815-offline-can-unsay-a-missing-diver is Accepted and governs this
 *   exact transition: asserting somebody is aboard over a stated missing-diver
 *   mark is "the one tap on this surface that turns the loudest row the product
 *   has into green", and **retracting a mark may never be harder than making
 *   one**. That record left the live manifest out on the stated grounds that
 *   "live already has the honest undo one tap away" — which stopped being true
 *   the moment slice 5a moved the exception control into the person's panel. So
 *   both directions cost the same two deliberate gestures now: open the person,
 *   then either "Mark back aboard" or a re-tap that retracts the mark. A
 *   dive-domain review of this slice caught the inversion.
 */
export function RollCallMarkButton({
  kind,
  subjectId,
  checkpoint,
  rollCall,
  action,
  copy,
  markState,
  t,
}: {
  /** Which list this row belongs to — the only thing that varies below. */
  kind: "diver" | "crew";
  /** A `bookings.id` for a diver, a `people.id` for a crew member. */
  subjectId: string;
  checkpoint: RollCallCheckpoint;
  rollCall: RollCallRecord | undefined;
  action: RollCallAction;
  copy: RollCallButtonCopy;
  markState: RollCallMarkState;
  t: StaffTranslator;
}) {
  const { boarded } = rollCallRowState(checkpoint, rollCall);
  const isCrew = kind === "crew";
  return (
    <RollCallButton
      // Forces a remount — and a fresh `useActionState` `result` — on every
      // checkpoint switch (see the component's own doc comment); this route/key
      // is otherwise identical across checkpoints, so without it a refusal from
      // one checkpoint can survive into another and misattribute.
      key={isCrew ? `crew-aboard-${checkpoint}` : `board-${checkpoint}`}
      action={action}
      subject={
        isCrew ? { field: "personId", id: subjectId } : { field: "bookingId", id: subjectId }
      }
      status={boarded ? "cleared" : "boarded"}
      label={
        isCrew
          ? boarded
            ? t("manifest.crewAboardCheckAriaLabel")
            : t("manifest.crewMarkAboard")
          : boarded
            ? t("manifest.boardedCheckAriaLabel")
            : t("manifest.markBoarded")
      }
      pendingLabel={
        isCrew ? t("manifest.saving") : boarded ? t("manifest.undoing") : t("manifest.boarding")
      }
      mark={<RollCallMark state={markState} />}
      className={MARK_BUTTON_CLASS}
      formClassName="shrink-0"
      copy={copy}
      observabilityAction={isCrew ? "roll-call-crew" : "roll-call-diver"}
    />
  );
}

/**
 * The exception — "not boarded" at the dock, "not back aboard" after a dive.
 *
 * **Only ever rendered inside an opened person panel.** That placement is the
 * second half of decision 3 and is not a styling choice: reaching it costs a
 * deliberate tap on the name first, which is what keeps the app's
 * highest-consequence claim out of thumb range of the nine ordinary taps
 * beside it.
 *
 * At rest it is a plain bordered control at every checkpoint — **no danger ink
 * until a human has recorded something** (decision 4: an alarm is earned by a
 * recorded fact, never by the absence of one). It used to render in danger tone
 * the moment the checkpoint was after a dive, which meant the ordinary opening
 * of every surface-interval count was red.
 *
 * The recorded states keep the words they had: at the dock a settled "Not
 * boarded ☑️", after a dive a danger-toned "Not back aboard" that never carries
 * a done-check — the worst string this surface ever produced was a green-checked
 * "Not boarded ✓" beside a diver who had not come back from dive one (DOM-H3).
 */
/**
 * "Mark back aboard" — the affirmative for a person a human has recorded **not
 * back aboard**, and the only place it can be made.
 *
 * It lives in the panel rather than on the row for the reason
 * ADR 20260815-offline-can-unsay-a-missing-diver spells out: this is the tap
 * that turns the loudest row the product has into green, and it must not sit
 * under a thumb running down a list of names on a rolling deck. Its cost is
 * deliberately the same as the retraction rendered beside it — neither
 * direction is the easy one.
 */
export function RollCallBackAboardControl({
  kind,
  subjectId,
  checkpoint,
  subjectName,
  action,
  copy,
  t,
}: {
  kind: "diver" | "crew";
  subjectId: string;
  checkpoint: RollCallCheckpoint;
  /** Named on the control, never a generic "Confirm" — see the ADR above. */
  subjectName: string;
  action: RollCallAction;
  copy: RollCallButtonCopy;
  t: StaffTranslator;
}) {
  const isCrew = kind === "crew";
  return (
    <div className="mt-3 print:hidden">
      <RollCallButton
        key={isCrew ? `crew-back-aboard-${checkpoint}` : `back-aboard-${checkpoint}`}
        // Unsaying a missing person is exactly when the sentence matters:
        // "surfaced 200 m north, picked up by Reef Runner at 14:31" is the
        // half of the record the mark alone cannot carry (ADR
        // 20260828-a-missing-diver-gets-a-sentence). It rides this submit.
        noteField={{
          name: "note",
          label: t("manifest.rollCallNoteLabel"),
          maxLength: ROLL_CALL_NOTE_MAX,
        }}
        action={action}
        subject={
          isCrew ? { field: "personId", id: subjectId } : { field: "bookingId", id: subjectId }
        }
        status="boarded"
        label={isCrew ? t("manifest.crewMarkBackAboard") : t("manifest.markBackAboard")}
        // The person by name, for a reader who arrives at this control from the
        // count panel's chips rather than by reading down the list.
        ariaLabel={`${isCrew ? t("manifest.crewMarkBackAboard") : t("manifest.markBackAboard")} — ${subjectName}`}
        pendingLabel={t("manifest.boarding")}
        className={`${BOAT_TARGET_CLASS} border border-success bg-success/15 text-success-strong`}
        copy={copy}
        observabilityAction={isCrew ? "roll-call-crew" : "roll-call-diver"}
      />
    </div>
  );
}

export function RollCallExceptionControl({
  kind,
  subjectId,
  checkpoint,
  isDeparture,
  rollCall,
  action,
  copy,
  t,
}: {
  kind: "diver" | "crew";
  subjectId: string;
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
  rollCall: RollCallRecord | undefined;
  action: RollCallAction;
  copy: RollCallButtonCopy;
  t: StaffTranslator;
}) {
  const { recordedNotBoarded, notBackAboard, recordedHere } = rollCallRowState(
    checkpoint,
    rollCall,
  );
  const isCrew = kind === "crew";
  return (
    <div className="mt-3 print:hidden">
      <RollCallButton
        // Same remount-on-checkpoint reasoning as the mark button above.
        key={isCrew ? `crew-not-aboard-${checkpoint}` : `not-boarded-${checkpoint}`}
        // **One box per row, and it belongs to whichever control is about to
        // say something new.** This one states "did not come back", so it
        // carries the box while nothing is recorded. Once the alarm stands,
        // "Mark back aboard" renders beside this and takes the box over: that
        // is the positive sighting worth describing ("I have eyes on her, she
        // came up 200 m north"), while this control's remaining job is
        // `cleared` — "nobody said it", a mis-tap with nothing to observe. Two
        // boxes asking one question, side by side, is what this avoids.
        //
        // Never at the dock: `not_boarded` there means "never left", which is
        // clerical and has never needed a sentence. The server drops one
        // anyway (`rollCallNoteAllowed`).
        noteField={
          isDeparture || notBackAboard
            ? undefined
            : {
                name: "note",
                label: t("manifest.rollCallNoteLabel"),
                maxLength: ROLL_CALL_NOTE_MAX,
              }
        }
        action={action}
        subject={
          isCrew ? { field: "personId", id: subjectId } : { field: "bookingId", id: subjectId }
        }
        status={recordedNotBoarded ? "cleared" : "not_boarded"}
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
        // already carries its own on-screen undo sentence just below, which a
        // screen reader reaches in the same forward read, so duplicating it
        // into the accessible name would say it twice.
        ariaLabel={
          recordedNotBoarded && isDeparture
            ? isCrew
              ? t("manifest.crewNotAboardCheckAriaLabel")
              : t("manifest.notBoardedCheckAriaLabel")
            : undefined
        }
        pendingLabel={t("manifest.saving")}
        className={`${BOAT_TARGET_CLASS} ${
          notBackAboard
            ? "border border-danger bg-danger/15 text-danger"
            : recordedNotBoarded
              ? "border border-border-strong bg-surface-sunken"
              : "border border-border-strong bg-surface hover:bg-surface-sunken"
        }`}
        copy={copy}
        observabilityAction={isCrew ? "roll-call-crew" : "roll-call-diver"}
      />
      {/* One row state still says how to take it back, and only one.
          Everywhere else the settled control speaks for itself. "Not back
          aboard" is the exception: it carries no done-check — nothing about it
          reads as a toggle — and it is the highest-consequence state on the
          page to leave wrong. Crew rows get it on the same terms; hiding it for
          crew taught the deck that a mis-tap on a divemaster was permanent. */}
      {recordedHere && notBackAboard ? (
        <p className="mt-2 text-sm text-muted">{t("manifest.tapToUndoNotBackAboard")}</p>
      ) : null}
    </div>
  );
}
