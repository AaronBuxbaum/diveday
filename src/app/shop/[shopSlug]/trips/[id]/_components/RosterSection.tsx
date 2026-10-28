import type { ReactNode } from "react";
import { AgencyCheckAll } from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckAll";
import { AgencyCheckHost } from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckHost";
import {
  agencyCheckAllCopy,
  agencyCheckCopies,
} from "@/app/shop/[shopSlug]/_components/agency-check/agency-check-copy";
import { DecompressionReminder } from "@/components/DecompressionReminder";
import { ScrollToHash } from "@/components/ScrollToHash";
import { sectionCardClass } from "@/components/ui/card";
import { StatusMarkColumn } from "@/components/ui/StatusMark";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { needsDecompressionCardReminder } from "@/lib/decompression-reminder";
import { signingDate } from "@/lib/guardian";
import { ADD_A_BOOKING_ID } from "./add-a-booking-id";
import { RosterAllClear } from "./RosterAllClear";
import { RosterGroup, RosterGroupBand } from "./RosterGroupBand";
import { RosterRow, type RosterRowContext } from "./RosterRow";
import {
  groupRoster,
  type RosterActions,
  type RosterRows,
  type RosterSlots,
  type RosterTrip,
  rosterPaymentStatusCopy,
  waiverControls,
} from "./roster-model";
import type { RosterEntry } from "./types";

export type {
  RosterActions,
  RosterArrival,
  RosterRows,
  RosterSlots,
  RosterTrip,
} from "./roster-model";

/** A group band and its seats, drawn only when the group has someone in it. */
function RosterSeatGroup({
  label,
  entries,
  settled,
  context,
  children,
}: {
  label: string;
  entries: RosterEntry[];
  /** Filed under a settled group ("Ready", "Checked in"): each mark is the drawn check. */
  settled: boolean;
  context: RosterRowContext;
  children?: ReactNode;
}) {
  if (entries.length === 0) return null;
  return (
    <>
      <RosterGroupBand label={`${label} · ${entries.length}`}>{children}</RosterGroupBand>
      <ul className="divide-y divide-border">
        {entries.map((entry) => (
          <RosterRow key={entry.booking.id} entry={entry} settled={settled} context={context} />
        ))}
      </ul>
    </>
  );
}

/**
 * **The guests ledger** — every seat on the departure filed under its group
 * ("Still to clear", "Ready", and once arrivals open "Checked in" and "Not
 * here"), then whatever the page slots in beneath them. Which group a seat
 * files under is `groupRoster` (`roster-model.ts`); each seat is a `RosterRow`.
 * One grouped ledger whose bands own the state words (ADR
 * 20260827-the-departure-is-two-working-surfaces, slice 5d).
 */
export function RosterSection({
  trip,
  rows,
  actions,
  slots = {},
}: {
  trip: RosterTrip;
  rows: RosterRows;
  actions: RosterActions;
  slots?: RosterSlots;
}) {
  const { locale, shopTimezone } = trip;
  const { whoWantsInGroup, suggestionsGroup, addDiverGroup, arrival, record } = slots;
  const { roster } = rows;
  const t = staffTranslator(locale);
  const controls = waiverControls(t, { rehearsal: trip.rehearsal });
  const groups = groupRoster({
    t,
    rows,
    requiresPayment: trip.requiresPayment,
    arrival,
    controls,
    record,
  });
  const { stillToClear, ready, here, notHere, hereMeta, blockedCount, sharedFacts, sailedMeta } =
    groups;
  // A record never asks for action, so a finished departure carries no reminder.
  const showsDecompressionReminder =
    !record &&
    needsDecompressionCardReminder({
      exceedsNoDecoLimits: trip.exceedsNoDecoLimits,
      seats: roster.map(({ booking }) => ({
        participantType: booking.participantType,
        released: booking.status === "no_show",
      })),
      divingCrew: trip.divingCrew,
    });
  // A record never celebrates a clearance: there was nothing left to clear.
  const showAllClear = roster.length > 0 && !record;
  const context: RosterRowContext = {
    t,
    trip,
    rows,
    actions,
    arrival,
    record: Boolean(record),
    countedAboardBlocked: record?.countedAboardBlocked,
    recordBelow: record?.below,
    sharedAdvisoryTexts: groups.sharedAdvisoryTexts,
    waiverControls: controls,
    paymentStatusCopy: rosterPaymentStatusCopy(t),
    refundEligible: trip.cancellationDeadline !== null && trip.cancellationDeadline > nowDate(),
    // Today, in the shop's own zone: the guardian rule measures the diver's age
    // on the day the release is *signed*, which for a paper release recorded
    // here is now — never the departure's date (ADR 20260907-guardian-co-signature).
    signedToday: signingDate(nowDate(), shopTimezone),
    offersCreateOrder: trip.paymentsConnected && trip.canManageOrders,
  };

  const hasTail = whoWantsInGroup != null || suggestionsGroup != null || addDiverGroup != null;
  // This departure's cards the browser extension can check, in roster order:
  // the whole of what its "Check all" may touch (H-105). Held seats are never
  // in the map (`getTripGuests`).
  const agencyCards = actions.agencyCheckAction
    ? roster.flatMap(({ person }) => rows.agencyCheckCardsByPerson?.get(person.id) ?? [])
    : [];
  const section = (
    <section
      id="roster"
      aria-label={t("trips.roster.heading")}
      // The departure page's `space-y-10` spaces this (K-262).
      className="scroll-mt-24"
    >
      {arrival?.instrument ? (
        <div className="mb-10 print:mb-4">{arrival.instrument(groups.deskWorkOpen)}</div>
      ) : null}
      {/* The departure page's H1 heads this tab. The moment the last blocker
          clears, nothing renders until an action on this page moves the count to
          zero — see RosterAllClear for why that has to be decided in the browser
          rather than here. Held back on an empty roster: "everyone is cleared"
          about nobody is not a finished thing. */}
      {showAllClear ? (
        <RosterAllClear blockedCount={blockedCount} label={t("trips.roster.allClear")} />
      ) : null}
      {showsDecompressionReminder ? (
        <div className="mb-10">
          <DecompressionReminder text={t("trips.roster.decompressionReminder")} />
        </div>
      ) : null}
      {actions.agencyCheckAction ? (
        <div>
          <AgencyCheckAll cards={agencyCards} copy={agencyCheckAllCopy(t, agencyCards.length)} />
        </div>
      ) : null}
      {roster.length > 0 || hasTail ? (
        // One ledger, not a stack of cards: everyone this departure is about,
        // in one card of hairline-ruled rows under group bands that own the
        // state words — the same object grammar as the manifest's roll call
        // and the check-in queue, so the trip tabs read as views of one
        // thing.
        <div
          className={sectionCardClass({
            padding: "none",
            className: "overflow-hidden",
          })}
        >
          {/* Inside the card, so mounting proves the rows a deep link scrolls
              to exist: a `<Link>` transition does not run the browser's own
              fragment scroll. */}
          <ScrollToHash />
          {/* The record's groups (UX review 2026-10-10, item 10): empty
              unless the departure is finished, and then the only ones. */}
          <RosterSeatGroup
            label={t("trips.roster.groupUnaccounted")}
            entries={groups.unaccounted}
            settled={false}
            context={context}
          />
          <RosterSeatGroup
            label={t("trips.roster.groupSailed")}
            entries={groups.sailed}
            settled
            context={context}
          >
            {sailedMeta ? <span className="text-xs text-muted">{sailedMeta}</span> : null}
          </RosterSeatGroup>
          <RosterSeatGroup
            label={t("trips.roster.groupDidNotSail")}
            entries={groups.didNotSail}
            settled={false}
            context={context}
          />
          <RosterSeatGroup
            label={t("trips.roster.groupTurnedAway")}
            entries={record ? groups.turnedAway : []}
            settled={false}
            context={context}
          />
          <RosterSeatGroup
            label={t("trips.roster.groupNotCounted")}
            entries={groups.uncounted}
            settled={false}
            context={context}
          />
          <RosterSeatGroup
            label={t("trips.roster.groupNoRollCall")}
            entries={groups.unrecorded}
            settled={false}
            context={context}
          />
          <RosterSeatGroup
            label={t("trips.roster.groupStillToClear")}
            entries={stillToClear}
            settled={false}
            context={context}
          >
            {/* The facts much of the boat shares, said once in the group
                band instead of photocopied down its rows (principle 9).
                They move below the label on a phone so the state word keeps
                its own readable line.

                The band aligns its title on this column's first baseline,
                so each line is `items-baseline` with its mark a column of
                its own: the words set that baseline, not the mark's foot
                (K-181: the title sat 5px under the first fact).

                From `sm` the column sits at the band's end, put there by
                the band's `justify-between`, but its lines start on one
                edge so their marks form a column (K-267: right-aligned,
                they stepped left line by line). */}
            {sharedFacts.length > 0 ? (
              <div className="flex w-full min-w-0 flex-col gap-1 text-xs sm:w-auto sm:max-w-[68%] sm:items-start">
                {sharedFacts.map(({ sentence, count }) => (
                  <p
                    key={sentence}
                    className="flex min-w-0 items-baseline gap-1.5 text-warning-strong"
                  >
                    <StatusMarkColumn variant="warning" />
                    <span>{t("trips.roster.sharedFactLine", { count, sentence })}</span>
                  </p>
                ))}
              </div>
            ) : null}
          </RosterSeatGroup>
          <RosterSeatGroup
            label={t("trips.roster.groupReady")}
            entries={ready}
            settled
            context={context}
          />
          <RosterSeatGroup
            label={t("trips.roster.groupCheckedIn")}
            entries={here}
            settled
            context={context}
          >
            {/* Boarding is the group's fact, said once (principle 9): five
                receipts each wearing "Boarded" is one word printed five
                times. Nothing at all before anybody boards. */}
            {hereMeta ? <span className="text-xs text-muted">{hereMeta}</span> : null}
          </RosterSeatGroup>
          <RosterSeatGroup
            label={t("trips.roster.groupNotHere")}
            entries={notHere}
            settled={false}
            context={context}
          />
          <RosterSeatGroup
            label={t("trips.roster.groupTurnedAway")}
            entries={record ? [] : groups.turnedAway}
            settled={false}
            context={context}
          />
          {whoWantsInGroup}
          {suggestionsGroup}
          {/* One box, so `#add-diver` holds the form its links and specs
              scope to; the box draws the group's rule (K-354). */}
          {addDiverGroup ? (
            // `print:hidden`: a search box and an Add button, which a printed
            // roster has no use for.
            <RosterGroup
              id="add-diver"
              label={t("trips.addDiver.heading")}
              className="print:hidden"
            >
              {/* The masthead's "Add a booking" lands here (A31); the group
                  keeps `#add-diver` for the doors elsewhere that open it. */}
              <div id={ADD_A_BOOKING_ID} className="scroll-mt-20 px-4 py-5 sm:px-5">
                {addDiverGroup}
              </div>
            </RosterGroup>
          ) : null}
        </div>
      ) : null}
    </section>
  );
  // The check's state lives above the rows, so a row whose card has just been
  // certified keeps its outcome and its Undo through the refresh (H-105).
  return actions.agencyCheckAction ? (
    <AgencyCheckHost
      action={actions.agencyCheckAction}
      addListedAction={actions.agencyListedAction}
      copies={agencyCheckCopies(t)}
    >
      {section}
    </AgencyCheckHost>
  ) : (
    section
  );
}
