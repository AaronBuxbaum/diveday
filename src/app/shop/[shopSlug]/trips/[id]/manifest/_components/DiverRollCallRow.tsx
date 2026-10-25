import { RollCallMark } from "@/components/RollCallMark";
import { rollCallRowTone } from "@/components/row-tones";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import { diverRowId } from "@/lib/element-id";
import { rollCallLabel, type TripManifest } from "@/lib/manifests";
import { diverCapsule, diverTypeBadge } from "./DiverRowCapsule";
import { DiverRowPanel } from "./DiverRowPanel";
import { DiverRowPrint } from "./DiverRowPrint";
import { DiverRowTrigger } from "./DiverRowTrigger";
import type { DiverRollCallContext } from "./diver-roll-call-context";
import { diverRowState } from "./diver-row-state";
import { PersonBuddyList } from "./PersonBuddyList";
import { PersonSheet } from "./PersonSheet";
import { personStatusTone } from "./person-status-tone";
import { personTrailWithCurrentRecord } from "./person-trail";
import {
  PAPER_ROW_CLASS,
  ROLL_CALL_ROW_CLASS,
  ROW_DISCLOSURE_SUMMARY_CLASS,
  RollCallMarkButton,
  rollCallMarkState,
  rollCallRuleClass,
  rollCallScrollMargin,
} from "./RollCallControls";

/**
 * **One diver's row**: a name and a mark at rest, the person sheet one tap
 * away, and every fact restated on paper. What the row *is* comes from one
 * derivation (`diverRowState`); this composes its parts.
 */
export function DiverRollCallRow({
  context,
  diver,
  index,
  divers,
  firstOnScreenBookingId,
  sharedAdvisoryTexts,
}: {
  context: DiverRollCallContext;
  diver: TripManifest["divers"][number];
  /** The row's position in the roster — the rail numbering. */
  index: number;
  /** The whole (withheld) roster, for the buddy list inside the sheet. */
  divers: TripManifest["divers"];
  firstOnScreenBookingId: string | undefined;
  sharedAdvisoryTexts: ReadonlySet<string>;
}) {
  const {
    crew,
    checkpoint,
    isDeparture,
    locale,
    timezone,
    notesByBooking,
    todayTrailByBooking,
    rollCallAction,
    rollCallButtonCopy,
    rollCallClosed,
    buddyTeamLabel,
    t,
  } = context;
  const state = diverRowState(diver, checkpoint, isDeparture, timezone);
  const { rc, rowState, recordedTone, blockedAtDock, alarmed, boardingControlShown } = state;
  const personTrail = personTrailWithCurrentRecord({
    trail: todayTrailByBooking?.get(diver.bookingId) ?? [],
    checkpoint,
    rollCall: rc,
    locale,
    timezone,
    t,
  });
  // `print:block` on the list above is what actually guarantees the
  // printed order, and `print:order-none` is the belt to its braces:
  // `order` has no effect at all outside a flex or grid container, so
  // on paper the DOM order *is* the order by construction rather than
  // by the cascade happening to emit the print variant last. Block
  // layout is also the one browsers fragment reliably across printed
  // pages, and `break-inside-avoid` then keeps a diver's row off a
  // page boundary — a name split in half on the sheet a coastguard
  // reads is a defect (dive-domain review 20260828). The printed table
  // rows do the same, for the same reason (`src/components/ui/table.tsx`).
  // `ROLL_CALL_ROW_CLASS` carries it, with the card's corner on paper.
  const rowClass = `${ROLL_CALL_ROW_CLASS} ${alarmed ? "order-first print:order-none" : ""} ${rollCallScrollMargin(isDeparture)} ${
    // Aboard over a block wears the blocked tone (`rollCallRowTone`).
    rollCallRowTone(recordedTone, blockedAtDock)
  }`;
  // The hairline above this row, in each of the two orders. On screen
  // the first row is the first alarmed one when there is any; on paper
  // it is always the top of the manifest.
  const ruleClass = rollCallRuleClass({
    firstOnScreen: diver.bookingId === firstOnScreenBookingId,
    firstOnPaper: index === 0,
  });
  const capsule = diverCapsule(diver, state, t);
  const typeBadge = diverTypeBadge(diver, t);
  // The one line under the name: **who said what, and when.** Roll call
  // is never optimistic and every result keeps its who-and-when, so the
  // moment a row is anything but "to call" it says so in words — which
  // is also what keeps every colour-carried state carrying a word
  // (decision 5). Nothing said yet renders nothing: an untouched row is
  // a name and an empty ring, and that is the whole message.
  //
  // **Time, not a timestamp.** "Boarded Aug 27, 2:52 PM EDT by the
  // recorder" wrapped to three lines under every settled name, which put
  // 60px of date between one diver and the next on a phone — and every
  // roll call for a departure happens on that departure's own day, so
  // the date was the one part nobody could be in doubt about. The full
  // timestamp is not lost: it prints, below, on the sheet that goes
  // ashore and may be read months later.
  const auditLabel = rollCallLabelText(t, rollCallLabel(checkpoint, rc));
  const bookingNotes = notesByBooking.get(diver.bookingId) ?? [];
  const teamLabel = buddyTeamLabel(diver.buddyTeam ? [diver.buddyTeam] : []);
  const rowTrigger = (
    <DiverRowTrigger
      diver={diver}
      index={index}
      capsule={capsule}
      typeBadge={typeBadge}
      lateAt={state.lateAt}
      checkedInAtDesk={state.checkedInAtDesk}
      locale={locale}
      timezone={timezone}
      t={t}
    />
  );
  const rowPrint = (
    <DiverRowPrint
      diver={diver}
      printedAlert={context.printedMedicalAlerts?.texts.get(diver.bookingId)}
      state={state}
      checkpoint={checkpoint}
      auditLabel={auditLabel}
      teamLabel={teamLabel}
      locale={locale}
      timezone={timezone}
      t={t}
    />
  );
  // **The packet's paper** (B03): the name line and the printed facts, the
  // same two parts the printed sheet has always carried, and no sheet or mark.
  if (context.paper) {
    return (
      <li id={diverRowId(diver.bookingId)} className={rowClass}>
        <div className={ruleClass}>
          <div className={PAPER_ROW_CLASS}>{rowTrigger}</div>
          {rowPrint}
        </div>
      </li>
    );
  }
  return (
    <li id={diverRowId(diver.bookingId)} className={rowClass}>
      <div className={ruleClass}>
        {/* The name column *is* the disclosure. One tap on the person
          opens everything the rail does not need this second — the
          "one tap away" tier of decision 2 — which is what lets the
          row at rest be a name and a mark instead of the name, two
          badges, a blocker list, a link, a note thread and two
          summary lines it used to be. */}
        <PersonSheet
          name={diver.fullName}
          triggerLabel={t("manifest.openPersonDetails", { name: diver.fullName })}
          // Role and age (B08): the rental fit is said once, lower down in
          // the facts, and a held seat's age belongs to a person not yet
          // confirmed aboard.
          subtitle={
            diver.identityWithheld
              ? t("manifest.personSheetHeldDiverSubtitle")
              : diver.age !== null && diver.age !== undefined
                ? t("manifest.personSheetDiverSubtitle", { age: diver.age })
                : t("manifest.personSheetDiverSubtitleNoAge")
          }
          status={{ text: auditLabel, tone: personStatusTone(rowState) }}
          trail={personTrail}
          todayLabel={t("manifest.personSheetToday")}
          noTodayEventsLabel={t("manifest.personSheetNoTodayEvents")}
          buddyLabel={t("manifest.personSheetBuddyTeam")}
          buddy={
            diver.buddyTeam ? (
              <PersonBuddyList
                teammates={diver.buddyTeam.others}
                divers={divers}
                crew={crew}
                checkpoint={checkpoint}
                t={t}
              />
            ) : null
          }
          closeLabel={t("manifest.closePersonDetails")}
          triggerClassName={`${ROW_DISCLOSURE_SUMMARY_CLASS} flex-wrap gap-y-2 sm:flex-nowrap print:flex-nowrap`}
          mark={
            rowState.notBackAboard ? (
              <RollCallMark state="notBack" />
            ) : boardingControlShown && !rollCallClosed ? (
              <RollCallMarkButton
                kind="diver"
                subjectId={diver.bookingId}
                checkpoint={checkpoint}
                rollCall={rc}
                action={rollCallAction}
                copy={rollCallButtonCopy(diver.bookingId)}
                markState={rollCallMarkState(rowState)}
                t={t}
              />
            ) : (
              // No tap, but still what was recorded: aboard or
              // ashore before the held ring (review of #1840). The ring only
              // where the dock withheld the tap, never on a closed roll call
              // (dive-domain review D8).
              <RollCallMark
                state={rollCallMarkState(rowState, { blockedAtDock: !boardingControlShown })}
              />
            )
          }
          trigger={rowTrigger}
        >
          <DiverRowPanel
            context={context}
            diver={diver}
            state={state}
            sharedAdvisoryTexts={sharedAdvisoryTexts}
            bookingNotes={bookingNotes}
          />
        </PersonSheet>
        {/* **Paper keeps everything the screen tucks away** (decision 2).
          The person sheet contributes nothing to print, so every
          fact behind the tap above is restated here unconditionally:
          the recorded state as a word, the exceptions the one capsule
          could not carry, the blockers at any checkpoint, the full
          depth advisory, and the contact block. The summary line above
          prints as it stands, so the name, the capsule and the
          who-and-when are already on the sheet and are not repeated. */}
        {rowPrint}
      </div>
    </li>
  );
}
