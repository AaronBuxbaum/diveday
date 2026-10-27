import { DecompressionReminder } from "@/components/DecompressionReminder";
import { MixedTrainingDepthWarning } from "@/components/MixedTrainingDepthWarning";
import { RollCallTouchCue } from "@/components/RollCallTouchCue";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { crewDives, needsDecompressionCardReminder } from "@/lib/decompression-reminder";
import { scopedId } from "@/lib/element-id";
import { withholdHeldSeatParticulars } from "@/lib/held-seat";
import { mixedTrainingDepthAdvisory } from "@/lib/training-mark";
import { DiverRollCallRow } from "./DiverRollCallRow";
import type { DiverRollCallContext } from "./diver-roll-call-context";
import { HoldPlace } from "./HoldPlace";
import { PrintedMedicalAlertsNote } from "./PrintedMedicalAlertsNote";
import { rollCallRowState, rollCallScrollMargin } from "./RollCallControls";
import { SharedDepthAdvisories, sharedDepthAdvisories } from "./SharedDepthAdvisories";

/** The diver half of the head count — every active booking, one row each. */
export function DiverRollCall({ context }: { context: DiverRollCallContext }) {
  const { idPrefix, divers: rosterDivers, checkpoint, isDeparture, locale, t } = context;
  // **A held seat shows the seat, not the matched person** (issue #1690,
  // H-79): everything below, on screen and on paper, reads the withheld row,
  // so no capsule, fact block or shared advisory can reach past it.
  const divers = rosterDivers.map(withholdHeldSeatParticulars);
  const { sharedAdvisories, sharedAdvisoryTexts } = sharedDepthAdvisories(divers, t);
  // At the dock only: after a dive the people are out of the water and the
  // plan is behind them. The printed packet is the departure sheet, so paper keeps it.
  const showsDecompressionReminder =
    isDeparture &&
    needsDecompressionCardReminder({
      exceedsNoDecoLimits: context.exceedsNoDecoLimits,
      seats: divers.map((diver) => ({
        participantType: diver.participantType,
        released: Boolean(diver.notHere || diver.turnedAway),
      })),
      divingCrew: crewDives(context.crew),
    });
  // Which row the reader sees first, which is not `divers[0]` once an alarm
  // pulls one up. Derived from the same `rollCallRowState` the rows use, so the
  // hairline above the top row cannot disagree with what `order-first` moved.
  const firstOnScreenBookingId =
    divers.find((diver) => rollCallRowState(checkpoint, diver.rollCall).notBackAboard)?.bookingId ??
    divers[0]?.bookingId;
  return (
    <section
      id={scopedId(idPrefix, "roll-call-list")}
      tabIndex={-1}
      className={`outline-none ${rollCallScrollMargin(isDeparture)}`}
    >
      {/* The checklist above folds when the checkpoint changes; this keeps the
          list where the crew's thumb was instead of letting it jump. */}
      <HoldPlace holdKey={checkpoint} />
      {/* **"Skip to roll call" lands here, below the pinned count card**
          (pixel-craft class 9). With no scroll margin the section landed on
          the chrome bar, under the sticky card — 113px tall at 1280, 173 at
          390 — which hid the heading and the first names. It wears the margin
          its own rows do, which reads the card's published height.

          No "Shop time: Eastern Daylight Time" beside the heading. Every time
          on this page is already the shop's own — that is the app's rule
          everywhere (`shops.timezone`, `scripts/lint-rules/timezone.grit`), not a property
          of this screen — and a crew reading a roll call at their own dock has
          no second zone to confuse it with.
          No standing caption under it either. "After a dive, 'not back aboard'
          means this diver has not returned to the boat" was a permanent warning
          sentence explaining a control that is no longer on the row — and a
          standing warning at a checkpoint where nothing has been recorded is
          exactly what decision 4 exists to stop. The control names itself,
          inside the panel where it lives. */}
      <h2 className={SECTION_TITLE_CLASS}>
        {t("manifest.checkpointRollCallHeading", {
          checkpoint: rollCallCheckpointText(t, checkpoint),
        })}
      </h2>
      {showsDecompressionReminder ? (
        <DecompressionReminder text={t("manifest.decompressionReminder")} />
      ) : null}
      <SharedDepthAdvisories sharedAdvisories={sharedAdvisories} locale={locale} t={t} />
      <MixedTrainingDepthWarning
        show={mixedTrainingDepthAdvisory(
          divers.flatMap((diver) =>
            !diver.identityWithheld && diver.trainingDive ? [diver.trainingDive] : [],
          ),
        )}
        t={t}
      />
      {/* Only on a packet printed with the medical alerts (issue #2990). */}
      {context.printedMedicalAlerts && context.printedMedicalAlerts.texts.size > 0 ? (
        <PrintedMedicalAlertsNote
          printed={context.printedMedicalAlerts}
          divers={divers}
          locale={locale}
          timezone={context.timezone}
          t={t}
        />
      ) : null}
      {/* **A flex column, and no `divide-y`** (decision 4, issue #1054).
          A diver recorded not back aboard is pulled to the top *on screen* with
          `order-first`, because that row is where a crew member taps to record
          her back and it is otherwise three or four screens below the alarm.
          `print:order-none` puts her back: the printed sheet goes ashore and
          into a coastguard's hands, and it stays in strict manifest order.

          `divide-y` cannot survive that. It draws its hairlines by DOM order,
          so the visually-first row would carry a stray top rule and the
          visually-last would lack one. Each row draws its own instead, off the
          two orders it actually has — and on an inner wrapper rather than the
          `<li>`, whose tone classes set `border-danger`/`border-success` for
          the 4px left edge and would win the top edge's colour too
          (`rollCallRuleClass`, which the crew list draws its rules off too).

          **`print:block` is what actually holds the printed order**, rather
          than `print:order-none` alone: `order` is inert outside a flex or
          grid container, so in block layout the DOM order is the printed order
          by construction instead of by the cascade emitting one variant after
          another. Block is also the layout mode browsers fragment reliably
          across printed pages. `order-first` is paint order only — it moves
          nothing in the DOM, tab or screen-reader order, which is why the
          count panel names the missing people in links rather than leaving
          this to carry the alarm on its own (dive-domain review 20260828). */}
      <ul
        className={sectionCardClass({
          padding: "none",
          className: "mt-3 flex flex-col overflow-hidden print:block",
        })}
      >
        {divers.map((diver, index) => (
          <DiverRollCallRow
            key={diver.bookingId}
            context={context}
            diver={diver}
            index={index}
            divers={divers}
            firstOnScreenBookingId={firstOnScreenBookingId}
            sharedAdvisoryTexts={sharedAdvisoryTexts}
          />
        ))}
      </ul>
      {/* The words for a press the touch guard refused, crew rows included (issue #2328). */}
      <RollCallTouchCue message={t("manifest.touchRefused")} />
    </section>
  );
}
