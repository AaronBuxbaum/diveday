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
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { needsDecompressionCardReminder } from "@/lib/decompression-reminder";
import { signingDate } from "@/lib/guardian";
import { cachedListFormat } from "@/lib/intl-cache";
import { rentalFitCompleteness } from "@/lib/rentals";
import { issueCourseFormQrAction } from "../course-form-qr-action";
import { ADD_A_BOOKING_ID } from "./add-a-booking-id";
import { CourseFormsQrProvider } from "./CourseFormsQr";
import { GuestFolios } from "./GuestFolios";
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
import { rowNotices } from "./roster-row-notices";
import { rowReasonLines } from "./roster-row-reasons";
import { rosterSeat } from "./roster-seat";
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
  const { stillToClear, blockedCount, sailedMeta } = groups;
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
  // the whole of what its "Check all" may touch (H-20261008-cert-check-extension). Held seats are never
  // in the map (`getTripGuests`).
  const agencyCards = actions.agencyCheckAction
    ? roster.flatMap(({ person }) => rows.agencyCheckCardsByPerson?.get(person.id) ?? [])
    : [];
  const overview = (
    <>
      {whoWantsInGroup}
      {suggestionsGroup}
      {/* One box, so `#add-diver` holds the form its links and specs
              scope to; the box draws the group's rule (K-354). */}
      {addDiverGroup ? (
        <RosterGroup id="add-diver" label={t("trips.addDiver.heading")}>
          {/* The masthead's "Add a booking" lands here (A31); the group
                  keeps `#add-diver` for the doors elsewhere that open it. */}
          <div id={ADD_A_BOOKING_ID} className="scroll-mt-20 px-4 py-5 sm:px-5">
            {addDiverGroup}
          </div>
        </RosterGroup>
      ) : null}
    </>
  );
  const section = (
    <CourseFormsQrProvider
      action={issueCourseFormQrAction.bind(null, trip.shopSlug, trip.tripId)}
      copy={{
        show: t("trips.roster.courseForms.showQr"),
        showFor: t("trips.roster.courseForms.showQrFor", { name: "{name}" }),
        title: t("trips.roster.courseForms.qrTitle"),
        scan: t("trips.roster.courseForms.qrScan"),
        close: t("trips.roster.courseForms.qrClose"),
        loading: t("trips.roster.courseForms.qrLoading"),
        failed: t("trips.roster.courseForms.qrFailed"),
      }}
    >
      <section
        id="roster"
        aria-label={t("trips.roster.heading")}
        // The departure page's `space-y-10` spaces this (K-262).
        className="scroll-mt-24"
      >
        {arrival?.instrument ? (
          <div className="mb-10 group-has-[[data-guest-folio]]/folio:hidden">
            {arrival.instrument(groups.deskWorkOpen)}
          </div>
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
              className:
                "overflow-hidden group-has-[[data-guest-folio]]/folio:overflow-visible group-has-[[data-guest-folio]]/folio:border-0 group-has-[[data-guest-folio]]/folio:bg-transparent group-has-[[data-guest-folio]]/folio:shadow-none",
            })}
          >
            {/* Inside the card, so mounting proves the rows a deep link scrolls
              to exist: a `<Link>` transition does not run the browser's own
              fragment scroll. */}
            <ScrollToHash />
            {record?.homeNotCounted ? (
              <p className="px-4 py-2 text-sm font-semibold text-danger">
                {t("trips.roster.recordHomeNotCounted", { count: record.homeNotCounted })}
              </p>
            ) : null}
            {!record ? (
              <div className="p-4 sm:p-6 group-has-[[data-guest-folio]]/folio:p-0">
                <GuestFolios
                  overview={overview}
                  initialBookingId={
                    rows.keepOpenBookingId ??
                    rows.paymentMarkRetry?.bookingId ??
                    rows.partyPreview?.leadBookingId
                  }
                  copy={{
                    heading: t("trips.folio.heading"),
                    search: t("trips.folio.search"),
                    all: t("trips.folio.all"),
                    next: t("trips.folio.next"),
                    empty: t("trips.folio.empty"),
                    party: t("trips.folio.party"),
                    attention: t("trips.folio.attention"),
                    requirementsMet: t("trips.folio.requirementsMet"),
                  }}
                  guests={roster.map((entry) => {
                    const seat = rosterSeat(entry, false, {
                      ...context,
                      sharedAdvisoryTexts: new Set(),
                    });
                    const reasons = rowReasonLines({ ...seat, ...rowNotices(seat) }).reasonLines;
                    const fit = rentalFitCompleteness(
                      rows.rentalFitByBooking.get(entry.booking.id) ?? null,
                      trip.shopRentalItems,
                      entry.booking.participantType,
                    );
                    const fitNeedsAttention =
                      !seat.identityUnconfirmed &&
                      entry.booking.participantType !== "rider" &&
                      (fit.state !== "complete" ||
                        Boolean(rows.rentalFitByBooking.get(entry.booking.id)?.needsStaffFitAt));
                    const lead = entry.booking.partyLeadBookingId ?? entry.booking.id;
                    const companions = roster.filter(
                      (other) =>
                        other.booking.id !== entry.booking.id &&
                        (other.booking.partyLeadBookingId ?? other.booking.id) === lead,
                    );
                    return {
                      id: entry.booking.id,
                      name: entry.person.fullName,
                      photoPath: seat.identityUnconfirmed ? null : entry.person.staffPhotoPath,
                      summary: seat.blockerTexts.length
                        ? t("trips.folio.beforeBoardingCount", { count: seat.blockerTexts.length })
                        : undefined,
                      status:
                        [
                          ...reasons.map((reason) => reason.text),
                          ...(fitNeedsAttention ? [t("trips.folio.fitNeeded")] : []),
                        ].join(" · ") || t("trips.folio.requirementsMet"),
                      needsAttention:
                        fitNeedsAttention ||
                        stillToClear.some((other) => other.booking.id === entry.booking.id),
                      party: companions.length
                        ? companions.map((other) => other.person.fullName).join(" · ")
                        : null,
                      panel: (
                        <RosterRow
                          entry={entry}
                          settled={false}
                          context={{ ...context, sharedAdvisoryTexts: new Set() }}
                          folio
                        />
                      ),
                    };
                  })}
                />
              </div>
            ) : (
              <>
                {/* The record's groups (UX review 2026-10-10, item 10): empty
              unless the departure is finished, and then the only ones. */}
                <RosterSeatGroup
                  label={t("trips.roster.groupUnaccounted")}
                  entries={groups.unaccounted}
                  settled={false}
                  context={context}
                />
                {groups.notCountedAfterDive.map(({ dive, entries }) => (
                  <RosterSeatGroup
                    key={dive}
                    label={t("trips.roster.groupNotCountedAfterDive", { dive })}
                    entries={entries}
                    settled={false}
                    context={context}
                  />
                ))}
                {crewNotCountedLines(record?.crewNotCountedAfterDive, locale).map(
                  ({ dive, names }) => (
                    <p key={dive} className="px-4 py-2 text-sm font-semibold text-danger">
                      {t("manifest.stage.crewNotCountedAfterDive", { dive, names })}
                    </p>
                  ),
                )}
                <RosterSeatGroup
                  label={t("trips.roster.groupSailed")}
                  entries={groups.sailed}
                  settled
                  context={context}
                >
                  {sailedMeta ? <span className="text-xs text-muted">{sailedMeta}</span> : null}
                </RosterSeatGroup>
                <RosterSeatGroup
                  label={t("trips.roster.groupJoinedAtSite")}
                  entries={groups.joinedAtSite}
                  settled
                  context={context}
                />
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
              </>
            )}
            {record ? overview : null}
          </div>
        ) : null}
      </section>
    </CourseFormsQrProvider>
  );
  // The check's state lives above the rows, so a row whose card has just been
  // certified keeps its outcome and its Undo through the refresh (H-20261008-cert-check-extension).
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

/** Crew the record names as not counted, one line per dive, names joined in the shop's words. */
function crewNotCountedLines(
  crew: readonly { name: string; dive: number }[] | undefined,
  locale: string,
): { dive: number; names: string }[] {
  const byDive = new Map<number, string[]>();
  for (const member of crew ?? []) {
    byDive.set(member.dive, [...(byDive.get(member.dive) ?? []), member.name]);
  }
  const list = cachedListFormat(locale, { style: "long", type: "conjunction" });
  return [...byDive].map(([dive, names]) => ({ dive, names: list.format(names) }));
}
