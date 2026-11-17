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
import { issueCourseFormQrAction } from "../course-form-qr-action";
import { ADD_A_BOOKING_ID } from "./add-a-booking-id";
import { CourseFormsQrProvider } from "./CourseFormsQr";
import { GuestFixList } from "./GuestFixList";
import { guestFixRows } from "./guest-fix-rows";
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
  const { sailedMeta } = groups;
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
  // Before the boat is home: the fix list, at Check-in with the desk's taps.
  const fixRows = record ? null : guestFixRows(context, { mode: arrival ? "checkin" : "all" });
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
        aria-label={t("trips.clock.guests")}
        // The departure page's `space-y-10` spaces this (K-262).
        className="scroll-mt-24"
      >
        {showsDecompressionReminder ? (
          <div className="mb-10">
            <DecompressionReminder text={t("trips.roster.decompressionReminder")} />
          </div>
        ) : null}
        {actions.agencyCheckAction ? (
          <div className="mb-10">
            <AgencyCheckAll cards={agencyCards} copy={agencyCheckAllCopy(t, agencyCards.length)} />
          </div>
        ) : null}
        {fixRows && (roster.length > 0 || hasTail) ? (
          <div className="space-y-10">
            {/* Mounted with the rows, so a deep link scrolls to a row that exists. */}
            <ScrollToHash />
            {roster.length > 0 ? (
              <GuestFixList
                sections={fixRows.sections}
                guests={fixRows.guests}
                top={arrival?.instrument?.(fixRows.deskWorkOpen)}
                addGuest={
                  addDiverGroup
                    ? { href: `#${ADD_A_BOOKING_ID}`, label: t("trips.clock.addGuest") }
                    : null
                }
                initialOpenId={
                  rows.keepOpenBookingId ??
                  rows.paymentMarkRetry?.bookingId ??
                  rows.partyPreview?.leadBookingId
                }
                copy={{ close: t("trips.fixList.close") }}
              />
            ) : null}
            {hasTail ? (
              <div className={sectionCardClass({ padding: "none", className: "overflow-hidden" })}>
                {overview}
              </div>
            ) : null}
          </div>
        ) : null}
        {record && (roster.length > 0 || hasTail) ? (
          // The finished departure's record: one card of hairline-ruled rows
          // under group bands that own the state words.
          <div className={sectionCardClass({ padding: "none", className: "overflow-hidden" })}>
            <ScrollToHash />
            {record.homeNotCounted ? (
              <p className="px-4 py-2 text-sm font-semibold text-danger">
                {t("trips.roster.recordHomeNotCounted", { count: record.homeNotCounted })}
              </p>
            ) : null}
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
            {crewNotCountedLines(record?.crewNotCountedAfterDive, locale).map(({ dive, names }) => (
              <p key={dive} className="px-4 py-2 text-sm font-semibold text-danger">
                {t("manifest.stage.crewNotCountedAfterDive", { dive, names })}
              </p>
            ))}
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
            {overview}
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
