import type { ReactNode } from "react";
import { AgencyCheckRow } from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckRow";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { StatusMark } from "@/components/ui/StatusMark";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import type { CountedAboardBlocked } from "@/lib/roll-call-readiness";
import type { PaymentStatusControlCopy } from "./PaymentStatusControl";
import { RosterRecordBlocked } from "./RosterRecordBlocked";
import type {
  RosterActions,
  RosterArrival,
  RosterRows,
  RosterTrip,
  WaiverControls,
} from "./roster-model";
import { rowHeader } from "./roster-row-header";
import { rowIdentity } from "./roster-row-identity";
import { rowNotices } from "./roster-row-notices";
import { rowOutstanding } from "./roster-row-outstanding";
import { rowReasonList } from "./roster-row-reason-list";
import { rowReasonLines } from "./roster-row-reasons";
import { rowReference } from "./roster-row-reference";
import { rosterSeat } from "./roster-seat";
import type { RosterEntry } from "./types";

/** What every row on the ledger reads, built once by `RosterSection`. */
export type RosterRowContext = {
  t: StaffTranslator;
  trip: RosterTrip;
  rows: RosterRows;
  actions: RosterActions;
  arrival: RosterArrival | undefined;
  /**
   * The departure is finished and this ledger is its record (UX review
   * 2026-10-10, item 10): the row says who, never what is left to do.
   */
  record: boolean;
  /** The record's seats counted aboard while blocked (`RosterRecord`). */
  countedAboardBlocked?: ReadonlyMap<string, CountedAboardBlocked>;
  /** Under a seat on that record, the diver's next dive (fifth-loop ideas, item 4). */
  recordBelow?: ReadonlyMap<string, ReactNode>;
  /** Depth sentences much of the boat shares, said once in the group band. */
  sharedAdvisoryTexts: ReadonlySet<string>;
  waiverControls: WaiverControls;
  paymentStatusCopy: PaymentStatusControlCopy;
  refundEligible: boolean;
  /** Today in the shop's zone — when a paper release recorded here is signed. */
  signedToday: CalendarDate;
  /** One answer for the seat's foot row: the link and the flush of the control after it. */
  offersCreateOrder: boolean;
};

/**
 * The drawn mark a cleared seat wears — the same circle-and-check geometry as
 * `SettledCheck`, so one hand drew every settled mark in the app. Decorative:
 * the group band above the row already says "Ready" in words, which is what
 * lets seven rows stop repeating it (ADR
 * 20260827-the-departure-is-two-working-surfaces; emoji never — decision 5).
 */
function ReadyMark({ className = "" }: { className?: string }) {
  return <StatusMark variant="success" size="md" className={className} />;
}

/**
 * **One seat on the guests ledger** — its name line, its reason lines, and the
 * one panel behind its mark (what the seat still needs, then what is true
 * about it, then notes, then the seat's own actions). `RosterSection` files
 * it under its group; this draws it.
 */
export function RosterRow({
  entry,
  settled: settledRow,
  context,
}: {
  entry: RosterEntry;
  /** Filed under a settled group ("Ready", "Checked in"): its mark is the drawn check. */
  settled: boolean;
  context: RosterRowContext;
}) {
  // The seat's facts, then each part of the row in the order the row reads:
  // every part sees what the parts before it drew, and nothing after it.
  const seat = rosterSeat(entry, settledRow, context);
  const s1 = { ...seat, ...rowHeader(seat) };
  const s2 = { ...s1, ...rowNotices(s1) };
  const s3 = { ...s2, ...rowReasonLines(s2) };
  const s4 = { ...s3, ...rowIdentity(s3) };
  const s5 = { ...s4, ...rowReasonList(s4) };
  // The training marks are the departure's (issue #2275), read here beside the seat.
  const s6 = { ...s5, ...rowOutstanding({ ...s5, trainingMarks: context.rows.trainingMarks }) };
  // One remedy per actual reason family, in the open beside that reason.
  // Sending a link records delivery only; readiness still comes from the server.
  let waiverPlaced = false;
  let certificationPlaced = false;
  let courseFormsPlaced = false;
  const reasonLines = s6.reasonLines.map((line) => {
    const blocker = s6.blockerTexts.find((item) => item.text === line.key)?.blocker;
    if (
      !waiverPlaced &&
      s6.waiverControl.action &&
      (line.key === "waiver" ||
        blocker?.code.startsWith("waiver_") ||
        blocker?.code === "guardian_signature_missing")
    ) {
      waiverPlaced = true;
      // Delivery changes the reason text, but must retain the send result's state.
      return { ...line, key: "waiver-remedy", actions: s6.waiverRemedy };
    }
    if (!certificationPlaced && blocker && BLOCKER_CATEGORY[blocker.code] === "certification") {
      certificationPlaced = true;
      return { ...line, actions: s6.certificationRemedy };
    }
    if (!courseFormsPlaced && blocker?.code.startsWith("course_form_") && s6.hasCourseForms) {
      courseFormsPlaced = true;
      return { ...line, actions: s6.courseFormsRemedy };
    }
    return line;
  });
  const s7 = { ...s6, ...rowReasonList({ ...s6, reasonLines }), ...rowReference(s6) };
  const {
    booking,
    person,
    t,
    arrival,
    arrivalControl,
    arrivalBelow,
    holdOpen,
    headerLeft,
    headerBadges,
    reEntryNote,
    identityContact,
    identityCheck,
    reasonList,
    outstanding,
    hasWork,
    reference,
    record,
    identityUnconfirmed,
  } = s7;
  const { rows, actions } = context;
  const countedBlocked = context.countedAboardBlocked?.get(booking.id);
  const badgeCluster =
    headerBadges.length > 0 ? (
      <div className="ms-auto flex flex-wrap items-center justify-end gap-2 max-sm:ms-0 max-sm:justify-start">
        {headerBadges}
      </div>
    ) : null;
  const markSummary = (
    <summary
      aria-label={t("trips.roster.detailsSummaryLabel", { name: person.fullName })}
      className={`absolute top-1 end-2 flex size-11 cursor-pointer list-none items-center justify-center rounded-lg transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:end-3 ${
        settledRow && !arrivalControl ? "text-success" : "text-muted hover:text-foreground"
      }`}
    >
      {settledRow && !arrivalControl ? (
        <ReadyMark />
      ) : (
        <DisclosureCaret
          direction="down"
          className="size-4 transition-transform group-open:rotate-180"
        />
      )}
    </summary>
  );
  return (
    <li
      key={booking.id}
      // Today's queue deep-links straight to the diver it is about;
      // scroll-mt keeps the row clear of the sticky shop header.
      id={`booking-${booking.id}`}
      className="relative scroll-mt-24 px-4 py-1 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pe-11">
        {/* From `sm`, the line's end (`ms-auto`, `justify-end`). On a
            phone, where this wraps under the name, the row's
            `justify-between` still sends an unwrapped cluster to the end,
            and a wrapped one starts on the name's column like the name's
            own wrap (K-278: it right-aligned to the mark's edge, on no
            shared edge). */}
        {arrivalControl && s7.blockerTexts.length === 0 ? (
          <>
            {/* **The desk's tap keeps the name's line at every width**: the
                name, its chips and its capsules wrap inside their own
                column, so "Check in" stands at the same edge, on the first
                line, of every row a finger runs down. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {headerLeft}
              {badgeCluster}
            </div>
            <div className="shrink-0 self-start">{arrivalControl}</div>
          </>
        ) : (
          <>
            {headerLeft}
            {badgeCluster}
          </>
        )}
      </div>
      {/* Blockers and their existing remedies stay visible. Optional facts and
          routine preparation remain in the guest's details. */}
      {record && countedBlocked ? <RosterRecordBlocked t={t} blocked={countedBlocked} /> : null}
      {record ? null : (
        <>
          {reasonList}
          {arrivalControl && s7.blockerTexts.length > 0 ? (
            <div className="mb-2 flex justify-end">{arrivalControl}</div>
          ) : null}
        </>
      )}
      {/* "Check with SSI", under the reason that says the card is pending
          (H-105): drawn only with the browser extension, and never on a held
          seat, whose matched diver's details are not yet this seat's. */}
      {record || identityUnconfirmed || !actions.agencyCheckAction ? null : (
        <AgencyCheckRow
          personId={person.id}
          cards={rows.agencyCheckCardsByPerson?.get(person.id) ?? []}
        />
      )}
      {arrival || record ? null : identityContact}
      {record ? null : identityCheck}
      {record ? null : reEntryNote}
      {arrivalBelow}
      {/* The Inbox's "Move to another departure" lands on `#move-booking-…`,
          which opens this row and the move inside it (fourth review, item 32). */}
      <AutoOpenDetails
        openOnHash={[`booking-${booking.id}`, `move-booking-${booking.id}`]}
        open={holdOpen}
        className="group"
      >
        {markSummary}
        {/* **One panel per seat** (owner, 2026-10-05: "confusing and ugly").
            It used to be a loose stack — fixes, then facts, each fact with
            its own fold, a note fold, a rule and a lone Remove — read
            straight off the row's white. Now it is one sunken card: what
            the seat still needs, then what is true about it, then notes,
            then the seat's own actions, each a band of its own. */}
        <div className="mb-3 rounded-lg border border-border bg-surface-sunken/50 p-4 sm:p-5">
          {(hasWork ||
            (!waiverPlaced && s6.waiverControl.action !== null) ||
            (!courseFormsPlaced && s6.hasCourseForms)) &&
          !record ? (
            <div className="mb-4 border-b border-border pb-4 [&>*:first-child]:mt-0">
              <p className="mb-2 text-sm font-semibold">
                {t("trips.roster.informationAndPreparation")}
              </p>
              {!waiverPlaced ? s6.waiverRemedy : null}
              {!courseFormsPlaced && s6.hasCourseForms ? s6.courseFormsRemedy : null}
              {outstanding}
            </div>
          ) : null}
          {reference}
        </div>
      </AutoOpenDetails>
    </li>
  );
}
