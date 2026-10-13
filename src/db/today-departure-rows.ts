import {
  helpRequestActionText,
  helpRequestDetailText,
  inviteFromWaitlistActionText,
  lastMinuteFillDetailText,
  missingContactDetailText,
  missingContactNamedDetailText,
  missingFitDetailText,
  missingFitNamedDetailText,
  openGuestsActionText,
  openLastMinuteDealActionText,
  openPrepListActionText,
  openTripActionText,
  ungatedNitroxDetailText,
  ungatedNitroxNamedDetailText,
  waitlistSeatDetailText,
} from "@/i18n/today-labels";
import { sayHelloSentences } from "@/i18n/welcome-cue-labels";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { lastMinuteEntryMatchesTripDate } from "@/lib/last-minute-list";
import { publicTripPath } from "@/lib/public-routes";
import {
  collapseDiverActions,
  collapseEmailDeliveries,
  type TodayAction,
  urgencyFor,
} from "@/lib/today";
import { welcomeCueFor } from "@/lib/welcome-cue";
import { pushCrewGapRows } from "./today-crew-gap-rows";
import type { TodayRowsContext } from "./today-rows-context";
import { at, shopDay } from "./today-shared";

/**
 * The rows each departure in the window raises (readiness, crew, fit, nitrox, contacts, the wait list, last-minute seats), then the email deliveries that bounced.
 */
export function pushDepartureRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { inWindow, readinessByTrip, shopSlug, timeZone, locale, t, now, helpRequestsByTrip } = ctx;
  const {
    missingFit,
    ungatedNitrox,
    missingContact,
    waitlisted,
    deliveryIssues,
    neverSentLastMinuteDeal,
    lastMinuteWindows,
    boardedAnywhere,
    sharedWelcomeSeats,
  } = ctx.wave;
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
          personName: request.personName,
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

    // **Say hello** (issue #1182, delight report D22). One row per departure,
    // never one per diver: the row is about the boat's roster, and five rows
    // saying "greet this person" would be a queue of pleasantries above the
    // work. It disappears on its own an hour after the boat is home, because
    // `welcomeCueFor` stops returning a cue there — nothing here has to
    // remember to stop.
    const welcomeCues = (sharedWelcomeSeats.get(trip.id) ?? []).flatMap((seat) => {
      const cue = welcomeCueFor({
        sharedAt: seat.sharedAt,
        lastDivedAt: seat.lastDivedAt,
        tripEndsAt: trip.endsAt,
        now,
      });
      return cue ? [{ name: seat.personName, cue }] : [];
    });
    if (welcomeCues.length > 0) {
      actions.push({
        id: `say-hello:${trip.id}`,
        kind: "say_hello",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: sayHelloSentences(t, locale, welcomeCues).join(" "),
        actionLabel: openGuestsActionText(t),
        href: tripHref,
        dueAt: trip.startsAt,
      });
    }

    // One diver is a row about that person, named; several stay one row about
    // the boat — the same rule as the emergency-contact row below.
    const withoutFit = missingFit.get(trip.id) ?? [];
    if (withoutFit.length > 0) {
      const lone = withoutFit.length === 1 ? withoutFit[0] : undefined;
      actions.push({
        id: `prep:${trip.id}`,
        kind: "dive_prep",
        urgency: urgencyFor(trip.startsAt, now),
        subject: lone ? lone.fullName : trip.title,
        context: when,
        departure,
        ...(lone ? {} : { aboutDeparture: true }),
        detail: lone ? missingFitNamedDetailText(t) : missingFitDetailText(t, withoutFit.length),
        actionLabel: openPrepListActionText(t),
        href: `${tripHref}/prep#${PREP_SECTION_ID}`,
        dueAt: trip.startsAt,
      });
    }

    const ungated = ungatedNitrox.get(trip.id) ?? [];
    if (ungated.length > 0) {
      const lone = ungated.length === 1 ? ungated[0] : undefined;
      actions.push({
        id: `nitrox:${trip.id}`,
        kind: "nitrox_gate",
        urgency: urgencyFor(trip.startsAt, now),
        subject: lone ? lone.fullName : trip.title,
        context: when,
        departure,
        ...(lone ? {} : { aboutDeparture: true }),
        detail: lone ? ungatedNitroxNamedDetailText(t) : ungatedNitroxDetailText(t, ungated.length),
        actionLabel: openPrepListActionText(t),
        href: `${tripHref}/prep#${PREP_SECTION_ID}`,
        dueAt: trip.startsAt,
      });
    }

    pushCrewGapRows(actions, ctx, { trip, when, departure, tripHref });

    // Emergency contact is a dock-settleable nudge, not a blocker, and only
    // worth surfacing once a boat is close (within three days). Beyond that it
    // is queue noise a diver still has time to fill in themselves.
    const withoutContact =
      urgencyFor(trip.startsAt, now) !== "later" ? (missingContact.get(trip.id) ?? []) : [];
    if (withoutContact.length > 0) {
      // One diver is a row about that person — named, like every other
      // single-diver row. Several stay one row about the boat.
      const lone = withoutContact.length === 1 ? withoutContact[0] : undefined;
      actions.push({
        id: `contact:${trip.id}`,
        kind: "emergency_contact",
        urgency: urgencyFor(trip.startsAt, now),
        subject: lone ? lone.fullName : trip.title,
        context: when,
        departure,
        ...(lone ? {} : { aboutDeparture: true }),
        detail: lone
          ? missingContactNamedDetailText(t)
          : missingContactDetailText(t, withoutContact.length),
        actionLabel: openTripActionText(t),
        href: tripHref,
        dueAt: trip.startsAt,
      });
    }

    // A trip within 3 days that's under capacity and has never had a
    // last-minute deal sent is lost revenue staff can still act on. One-shot
    // per trip: once any blast has gone out, Today stops nudging even if
    // seats are still open — a shop that's already tried isn't nagged, but
    // can always resend from the trip page itself (docs ADR
    // 20260727-last-minute-fill-promos).
    const openSeats = Math.max(0, trip.capacity - trip.booked);
    // The reach test goes last on purpose: it is the only clause that scans a
    // list, and the three before it rule out most departures for free.
    //
    // Why it is there at all — a shop with an empty last-minute list, or one
    // whose members all stated dates that miss this departure, was being told
    // to "fill these seats" and handed a panel whose only content was an empty
    // state. The Trip surface now hides that panel outright when nobody
    // matches, so this row's own `#last-minute-deal` anchor would land on
    // nothing. A queue row must be work someone can actually do
    // (design/principles.md #10).
    if (
      openSeats > 0 &&
      urgencyFor(trip.startsAt, now) !== "later" &&
      neverSentLastMinuteDeal.has(trip.id) &&
      lastMinuteWindows.some((entry) =>
        lastMinuteEntryMatchesTripDate(entry, shopDay(trip.startsAt, timeZone)),
      )
    ) {
      actions.push({
        id: `last-minute-fill:${trip.id}`,
        kind: "last_minute_fill",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: lastMinuteFillDetailText(t, openSeats),
        actionLabel: openLastMinuteDealActionText(t),
        href: `${tripHref}?view=details#last-minute-deal`,
        dueAt: trip.startsAt,
      });
    }

    const front = waitlisted.get(trip.id);
    const waiting = front?.count ?? 0;
    if (front && waiting > 0 && openSeats > 0) {
      actions.push({
        id: `waitlist:${trip.id}`,
        kind: "waitlist_seat",
        urgency: urgencyFor(trip.startsAt, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: waitlistSeatDetailText(t, openSeats, waiting),
        // One tap invites the longest-waiting diver without leaving Today; the href
        // stays the row's real destination — a pre-hydration tap, a middle-click
        // or an open-in-new-tab lands on the trip's wait-list section.
        actionLabel: inviteFromWaitlistActionText(t),
        href: `${tripHref}#waitlist`,
        invite: {
          tripId: trip.id,
          entryId: front.entryId,
          personName: front.personName,
          personEmail: front.personEmail,
          invitedAt: front.invitedAt,
          bookingPath: publicTripPath(shopSlug, trip.id),
          tripTitle: trip.title,
          tripWhen: when,
        },
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
