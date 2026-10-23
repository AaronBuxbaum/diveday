import { boatWorkSentence } from "@/i18n/boat-work-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  boatWorkItemText,
  helpRequestActionText,
  helpRequestDetailText,
  kitUnaskedGroupDetailText,
  missingContactNamedDetailText,
  missingFitNamedDetailText,
  offerSeatActionText,
  openOrdersActionText,
  openPrepListActionText,
  openTripActionText,
  seatWantedDetailText,
  ungatedNitroxNamedDetailText,
} from "@/i18n/today-labels";
import { type BoatWorkItem, boatWorkItems } from "@/lib/boat-work";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { lastMinuteEntryMatchesTripDate } from "@/lib/interests";
import { publicTripPath } from "@/lib/public-routes";
import { shopPath } from "@/lib/staff-notices";
import {
  blockedDiverActions,
  collapseEmailDeliveries,
  type TodayAction,
  urgencyFor,
  waiverBatchActions,
} from "@/lib/today";
import { type BoatWork, type BoatWorkDiver, boatWorkFor } from "./boat-work";
import { pushCrewGapRows } from "./today-crew-gap-rows";
import type { TodayRowsContext } from "./today-rows-context";
import { at, shopDay } from "./today-shared";

/**
 * The rows each departure in the window raises (readiness, crew, fit, nitrox, contacts, the wait list, last-minute seats), then the email deliveries that bounced.
 */
export function pushDepartureRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { inWindow, readinessByTrip, shopSlug, timeZone, locale, t, now, helpRequestsByTrip } = ctx;
  const { boatWork, seatWanted, deliveryIssues, lastMinuteWindows, boardedAnywhere } = ctx.wave;
  for (const trip of inWindow) {
    const tripHref = `/shop/${shopSlug}/trips/${trip.id}`;
    const when = at(trip.startsAt, timeZone, locale);
    // Every row this trip contributes shares one departure header in the
    // queue; the rows themselves then never repeat the boat's name.
    const departure = { tripId: trip.id, label: `${trip.title} · ${when}` };

    for (const request of helpRequestsByTrip.get(trip.id) ?? []) {
      actions.push({
        id: `help-request:${request.id}`,
        kind: "help_request",
        urgency: urgencyFor(trip.startsAt, now),
        subject: request.personName,
        context: when,
        departure,
        detail: helpRequestDetailText(t, {
          kind: request.kind,
          status: request.status,
          helperPersonName: request.helperPersonName,
        }),
        actionLabel: helpRequestActionText(t, request.helperPersonName),
        href: `${tripHref}#booking-${request.bookingId}`,
        helpRequest: {
          requestId: request.id,
          revision: request.revision,
          status: request.status,
          helperPersonId: request.helperPersonId,
          helperPersonName: request.helperPersonName,
          crew: request.crew,
          meetingInstructions: request.meetingInstructions,
        },
        dueAt: trip.startsAt,
      });
    }

    const blockedDivers = (readinessByTrip.get(trip.id) ?? [])
      .filter((row) => row.readiness.status === "blocked")
      .map((row) => ({
        bookingId: row.booking.id,
        personId: row.person.id,
        fullName: row.person.fullName,
        tripId: trip.id,
        tripTitle: `${trip.title} · ${when}`,
        startsAt: trip.startsAt,
        blockers: row.readiness.blockers,
        aboard: boardedAnywhere.get(trip.id)?.has(row.booking.id) === true,
      }));
    actions.push(
      ...waiverBatchActions(blockedDivers, shopSlug, now, t),
      ...blockedDiverActions(blockedDivers, shopSlug, now, t),
    );

    // **The boat's work** (third review, item 4): sizes, nitrox, contacts and
    // open orders, decided by `boatWorkItems` from the one reader the trip's
    // own band reads, in the same words. Each diver's gap is a row about that
    // person, named (UX delight sheet 2026-10-22, item 4), which
    // `oneRowPerDiver` folds with the rest of their gaps on this boat; orders
    // cannot name a person and stay one row about the boat.
    const work = boatWorkFor(boatWork, trip.id);
    for (const item of boatWorkItems(
      {
        missingSize: work.missingSize.length,
        kitUnasked: work.kitUnasked.length,
        ungatedNitrox: work.ungatedNitrox.length,
        missingContact: work.missingContact.length,
        openOrders: work.openOrders,
      },
      { startsAt: trip.startsAt, now },
    )) {
      if (item.code === "open_orders") {
        // The index the row opens is filtered to the departure, the same door the band uses.
        actions.push({
          id: `orders:${trip.id}`,
          kind: "payment",
          urgency: urgencyFor(trip.startsAt, now),
          subject: trip.title,
          context: when,
          departure,
          aboutDeparture: true,
          detail: boatWorkSentence(t, item),
          actionLabel: openOrdersActionText(t),
          href: `${shopPath(shopSlug, "orders")}?tripId=${trip.id}&status=open&range=all`,
          dueAt: trip.startsAt,
        });
        continue;
      }
      // **Not asked about kit, one line per boat** (Aaron 2026-10-23): two or
      // more divers nobody has asked share one row naming them, because the
      // fix is the same walk down the prep list. One diver keeps their own row.
      const kitGroup = item.code === "missing_sizes" && work.kitUnasked.length > 1;
      if (kitGroup) {
        actions.push({
          id: `kit-unasked:${trip.id}`,
          kind: "dive_prep",
          urgency: urgencyFor(trip.startsAt, now),
          subject: trip.title,
          context: when,
          departure,
          aboutDeparture: true,
          detail: kitUnaskedGroupDetailText(
            t,
            work.kitUnasked.map((diver) => diver.fullName),
          ),
          actionLabel: openPrepListActionText(t),
          href: `${tripHref}/prep#${PREP_SECTION_ID}`,
          dueAt: trip.startsAt,
        });
      }
      for (const gap of boatWorkGaps(item.code, work, { tripHref, t, kitGroup })) {
        actions.push({
          id: `${gap.idPrefix}:${trip.id}:${gap.diver.personId}`,
          kind: gap.kind,
          urgency: urgencyFor(trip.startsAt, now),
          subject: gap.diver.fullName,
          context: when,
          departure,
          detail: gap.namedDetail,
          actionLabel: gap.actionLabel,
          href: gap.href,
          diver: { personId: gap.diver.personId, items: [gap.item] },
          dueAt: trip.startsAt,
        });
      }
    }

    pushCrewGapRows(actions, ctx, { trip, when, departure, tripHref });

    // Against the seats on sale, as the booking transaction counts (#2388).
    const openSeats = Math.max(0, trip.sellableCapacity - trip.booked);
    const front = seatWanted.get(trip.id);
    // **One item for everyone who wants in** (ADR 20261017-one-interest-with-a-scope):
    // the divers who asked for this boat, and, within three days, the
    // last-minute list divers whose window covers it. The reach test is the
    // only clause that scans a list, so it goes last. A row is work someone can
    // do (design/principles.md #10): with only the list to offer to, the tap is
    // the panel's door; with someone waiting it offers the seat in place.
    const waiting = front?.count ?? 0;
    // The one tap goes to the first who asked whose whole party fits; none
    // fitting leaves the row and its link to the panel, with no tap to send.
    const fits = front?.interests.find((interest) => interest.partySize <= openSeats);
    const around =
      openSeats > 0 && urgencyFor(trip.startsAt, now) !== "later"
        ? lastMinuteWindows.filter((entry) =>
            lastMinuteEntryMatchesTripDate(entry, shopDay(trip.startsAt, timeZone)),
          ).length
        : 0;
    if (openSeats > 0 && waiting + around > 0) {
      actions.push({
        id: `seat-wanted:${trip.id}`,
        kind: "seat_wanted",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: seatWantedDetailText(t, openSeats, waiting + around),
        // One tap offers the seat to whoever asked first without leaving Today;
        // the href stays the row's real destination — a pre-hydration tap, a
        // middle-click or an open-in-new-tab lands on the trip's panel.
        actionLabel: offerSeatActionText(t),
        href: `${tripHref}#who-wants-in`,
        ...(fits
          ? {
              offer: {
                tripId: trip.id,
                interestId: fits.interestId,
                personName: fits.personName,
                personEmail: fits.personEmail,
                offeredAt: fits.invitedAt,
                bookingPath: publicTripPath(shopSlug, trip.id),
                tripTitle: trip.title,
                tripWhen: when,
              },
            }
          : {}),
        dueAt: trip.startsAt,
      });
    }
  }

  actions.push(
    ...collapseEmailDeliveries(
      deliveryIssues.map((issue) => ({
        deliveryId: issue.delivery.id,
        bookingId: issue.booking.id,
        fullName: issue.person.fullName,
        personId: issue.person.id,
        isWaiver: issue.delivery.kind !== "booking_confirmation",
        status: issue.delivery.status,
        trip: {
          id: issue.trip.id,
          startsAt: issue.trip.startsAt,
          label: `${issue.trip.title} · ${at(issue.trip.startsAt, timeZone, locale)}`,
        },
      })),
      shopSlug,
      now,
      t,
    ),
  );
}

/** One diver's gap from a boat's work, as a Today row about that diver: its kind, its door, its words. */
type BoatWorkGap = {
  idPrefix: string;
  kind: TodayAction["kind"];
  diver: BoatWorkDiver;
  namedDetail: string;
  item: string;
  actionLabel: string;
  href: string;
};

/** Every diver an item of a boat's work names, each as their own gap. */
function boatWorkGaps(
  code: Exclude<BoatWorkItem["code"], "open_orders">,
  work: BoatWork,
  { tripHref, t, kitGroup }: { tripHref: string; t: StaffTranslator; kitGroup: boolean },
): BoatWorkGap[] {
  const prepHref = `${tripHref}/prep#${PREP_SECTION_ID}`;
  switch (code) {
    case "missing_sizes":
      return [
        ...work.missingSize.map((diver) => ({
          idPrefix: "prep",
          kind: "dive_prep" as const,
          diver,
          namedDetail: missingFitNamedDetailText(t, false),
          item: boatWorkItemText(t, "missing_size"),
          actionLabel: openPrepListActionText(t),
          href: prepHref,
        })),
        // A boat's unasked divers already have their one shared row.
        ...(kitGroup ? [] : work.kitUnasked).map((diver) => ({
          idPrefix: "prep",
          kind: "dive_prep" as const,
          diver,
          namedDetail: missingFitNamedDetailText(t, true),
          item: boatWorkItemText(t, "kit_unasked"),
          actionLabel: openPrepListActionText(t),
          href: prepHref,
        })),
      ];
    case "ungated_nitrox":
      return work.ungatedNitrox.map((diver) => ({
        idPrefix: "nitrox",
        kind: "nitrox_gate" as const,
        diver,
        namedDetail: ungatedNitroxNamedDetailText(t),
        item: boatWorkItemText(t, "ungated_nitrox"),
        actionLabel: openPrepListActionText(t),
        href: prepHref,
      }));
    case "missing_contact":
      return work.missingContact.map((diver) => ({
        idPrefix: "contact",
        kind: "emergency_contact" as const,
        diver,
        namedDetail: missingContactNamedDetailText(t),
        item: boatWorkItemText(t, "missing_contact"),
        actionLabel: openTripActionText(t),
        href: tripHref,
      }));
  }
}
