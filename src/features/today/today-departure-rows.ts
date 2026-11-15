import {
  type BoatWork,
  type BoatWorkDiver,
  type BoatWorkItem,
  boatWorkFor,
  boatWorkItems,
  boatWorkSentence,
} from "@/features/boat-work";
import { urgencyFor } from "@/features/today-urgency";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  boatWorkItemText,
  helpRequestActionText,
  helpRequestDetailText,
  kitUnaskedGroupDetailText,
  missingContactGroupDetailText,
  missingContactNamedDetailText,
  missingFitNamedDetailText,
  missingSizeGroupDetailText,
  offerSeatActionText,
  openOrdersActionText,
  openPrepListActionText,
  openTripActionText,
  seatWantedDetailText,
  ungatedNitroxGroupDetailText,
  ungatedNitroxNamedDetailText,
} from "@/i18n/today-labels";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { lastMinuteEntryMatchesTripDate } from "@/lib/interests";
import { publicTripPath } from "@/lib/public-routes";
import { shopPath } from "@/lib/staff-notices";
import {
  blockedDiverActions,
  collapseEmailDeliveries,
  type TodayAction,
  waiverBatchActions,
} from "./today";
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
      // **One line per boat for the same gap** (Aaron 2026-10-23, 2026-11-13):
      // two or more divers nobody has asked about kit, with no size, whose
      // nitrox card is unverified or with no emergency contact share one row
      // naming them, because the fix is the same walk down one list. One diver
      // keeps their own row, which `oneRowPerDiver` merges with their other gaps.
      const groups = boatWorkGroups(item.code, work, { tripHref, t });
      for (const group of groups) {
        actions.push({
          id: `${group.idPrefix}:${trip.id}`,
          kind: group.kind,
          urgency: urgencyFor(trip.startsAt, now),
          subject: trip.title,
          context: when,
          departure,
          aboutDeparture: true,
          detail: group.detail,
          actionLabel: group.actionLabel,
          href: group.href,
          dueAt: trip.startsAt,
        });
      }
      const grouped = new Set(groups.map((group) => group.list));
      for (const gap of boatWorkGaps(item.code, work, { tripHref, t, grouped })) {
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

/** The lists of a boat's work that name divers, and so can share one row. */
type BoatWorkList = "missingSize" | "kitUnasked" | "ungatedNitrox" | "missingContact";

/** One row naming every diver a list of a boat's work counts. */
type BoatWorkGroup = {
  list: BoatWorkList;
  idPrefix: string;
  kind: TodayAction["kind"];
  detail: string;
  actionLabel: string;
  href: string;
};

/**
 * The shared row for each list of a boat's work that names two or more divers.
 * Every name is said: the row has no "and N more" to open.
 */
function boatWorkGroups(
  code: Exclude<BoatWorkItem["code"], "open_orders">,
  work: BoatWork,
  { tripHref, t }: { tripHref: string; t: StaffTranslator },
): BoatWorkGroup[] {
  const prepHref = `${tripHref}/prep#${PREP_SECTION_ID}`;
  const names = (divers: readonly BoatWorkDiver[]) => divers.map((diver) => diver.fullName);
  const groups: BoatWorkGroup[] = [];
  if (code === "missing_sizes") {
    if (work.missingSize.length > 1) {
      groups.push({
        list: "missingSize",
        idPrefix: "size-missing",
        kind: "dive_prep",
        detail: missingSizeGroupDetailText(t, names(work.missingSize)),
        actionLabel: openPrepListActionText(t),
        href: prepHref,
      });
    }
    if (work.kitUnasked.length > 1) {
      groups.push({
        list: "kitUnasked",
        idPrefix: "kit-unasked",
        kind: "dive_prep",
        detail: kitUnaskedGroupDetailText(t, names(work.kitUnasked)),
        actionLabel: openPrepListActionText(t),
        href: prepHref,
      });
    }
  }
  if (code === "ungated_nitrox" && work.ungatedNitrox.length > 1) {
    groups.push({
      list: "ungatedNitrox",
      idPrefix: "nitrox-group",
      kind: "nitrox_gate",
      detail: ungatedNitroxGroupDetailText(t, names(work.ungatedNitrox)),
      actionLabel: openPrepListActionText(t),
      href: prepHref,
    });
  }
  if (code === "missing_contact" && work.missingContact.length > 1) {
    groups.push({
      list: "missingContact",
      idPrefix: "contact-group",
      kind: "emergency_contact",
      detail: missingContactGroupDetailText(t, names(work.missingContact)),
      actionLabel: openTripActionText(t),
      href: tripHref,
    });
  }
  return groups;
}

/** Every diver an item of a boat's work names, each as their own gap. */
function boatWorkGaps(
  code: Exclude<BoatWorkItem["code"], "open_orders">,
  work: BoatWork,
  {
    tripHref,
    t,
    grouped,
  }: { tripHref: string; t: StaffTranslator; grouped: ReadonlySet<BoatWorkList> },
): BoatWorkGap[] {
  const prepHref = `${tripHref}/prep#${PREP_SECTION_ID}`;
  switch (code) {
    case "missing_sizes":
      return [
        ...(grouped.has("missingSize") ? [] : work.missingSize).map((diver) => ({
          idPrefix: "prep",
          kind: "dive_prep" as const,
          diver,
          namedDetail: missingFitNamedDetailText(t, false),
          item: boatWorkItemText(t, "missing_size"),
          actionLabel: openPrepListActionText(t),
          href: prepHref,
        })),
        // A boat's unasked divers already have their one shared row.
        ...(grouped.has("kitUnasked") ? [] : work.kitUnasked).map((diver) => ({
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
      return (grouped.has("ungatedNitrox") ? [] : work.ungatedNitrox).map((diver) => ({
        idPrefix: "nitrox",
        kind: "nitrox_gate" as const,
        diver,
        namedDetail: ungatedNitroxNamedDetailText(t),
        item: boatWorkItemText(t, "ungated_nitrox"),
        actionLabel: openPrepListActionText(t),
        href: prepHref,
      }));
    case "missing_contact":
      return (grouped.has("missingContact") ? [] : work.missingContact).map((diver) => ({
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
