import { boatWorkSentence } from "@/i18n/boat-work-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  helpRequestActionText,
  helpRequestDetailText,
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
import { lastMinuteEntryMatchesTripDate } from "@/lib/leads";
import { publicTripPath } from "@/lib/public-routes";
import { shopPath } from "@/lib/staff-notices";
import {
  collapseDiverActions,
  collapseEmailDeliveries,
  type TodayAction,
  urgencyFor,
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
        }),
        actionLabel: helpRequestActionText(t, request.status),
        href: `${tripHref}#booking-${request.bookingId}`,
        helpRequest: { requestId: request.id, status: request.status },
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
    actions.push(...collapseDiverActions(blockedDivers, shopSlug, now, t));

    // **The boat's work** (third review, item 4): sizes, nitrox, contacts and
    // open orders, decided by `boatWorkItems` from the one reader the trip's
    // own band reads, in the same words. One diver is a row about that
    // person, named; several stay one row about the boat.
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
      const row = boatWorkRow(item, work, {
        tripHref,
        ordersHref: `${shopPath(shopSlug, "orders")}?tripId=${trip.id}&status=open&range=all`,
        t,
      });
      const lone = row.divers.length === 1 ? row.divers[0] : undefined;
      actions.push({
        id: `${row.idPrefix}:${trip.id}`,
        kind: row.kind,
        urgency: urgencyFor(trip.startsAt, now),
        subject: lone ? lone.fullName : trip.title,
        context: when,
        departure,
        ...(lone ? {} : { aboutDeparture: true }),
        detail: lone ? row.namedDetail : boatWorkSentence(t, item),
        actionLabel: row.actionLabel,
        href: row.href,
        dueAt: trip.startsAt,
      });
    }

    pushCrewGapRows(actions, ctx, { trip, when, departure, tripHref });

    // Against the seats on sale, as the booking transaction counts (#2388).
    const openSeats = Math.max(0, trip.sellableCapacity - trip.booked);
    const front = seatWanted.get(trip.id);
    // **One item for everyone who wants in** (ADR 20261017-one-lead-with-a-scope):
    // the divers who asked for this boat, and, within three days, the
    // last-minute list divers whose window covers it. The reach test is the
    // only clause that scans a list, so it goes last. A row is work someone can
    // do (design/principles.md #10): with only the list to offer to, the tap is
    // the panel's door; with someone waiting it offers the seat in place.
    const waiting = front?.count ?? 0;
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
        ...(front
          ? {
              offer: {
                tripId: trip.id,
                leadId: front.leadId,
                personName: front.personName,
                personEmail: front.personEmail,
                offeredAt: front.invitedAt,
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

/** What one item of a boat's work becomes as a Today row: its kind, its door, and its named form. */
function boatWorkRow(
  item: BoatWorkItem,
  work: BoatWork,
  { tripHref, ordersHref, t }: { tripHref: string; ordersHref: string; t: StaffTranslator },
): {
  idPrefix: string;
  kind: TodayAction["kind"];
  divers: readonly BoatWorkDiver[];
  namedDetail: string;
  actionLabel: string;
  href: string;
} {
  switch (item.code) {
    case "missing_sizes":
      return {
        idPrefix: "prep",
        kind: "dive_prep",
        divers: [...work.missingSize, ...work.kitUnasked],
        namedDetail: missingFitNamedDetailText(t, work.missingSize.length === 0),
        actionLabel: openPrepListActionText(t),
        href: `${tripHref}/prep#${PREP_SECTION_ID}`,
      };
    case "ungated_nitrox":
      return {
        idPrefix: "nitrox",
        kind: "nitrox_gate",
        divers: work.ungatedNitrox,
        namedDetail: ungatedNitroxNamedDetailText(t),
        actionLabel: openPrepListActionText(t),
        href: `${tripHref}/prep#${PREP_SECTION_ID}`,
      };
    case "missing_contact":
      return {
        idPrefix: "contact",
        kind: "emergency_contact",
        divers: work.missingContact,
        namedDetail: missingContactNamedDetailText(t),
        actionLabel: openTripActionText(t),
        href: tripHref,
      };
    case "open_orders":
      // Orders are about the boat, never one named diver: the index the row
      // opens is filtered to the departure, the same door the band uses.
      return {
        idPrefix: "orders",
        kind: "payment",
        divers: [],
        namedDetail: "",
        actionLabel: openOrdersActionText(t),
        href: ordersHref,
      };
  }
}
