import {
  boatClashDetailText,
  crewClashDetailText,
  crewClashSailedDetailText,
  openCrewActionText,
  openRollCallActionText,
  openTripActionText,
  rollCallAlertedText,
  rollCallGapDetailText,
} from "@/i18n/today-labels";
import { formatDateTimeTz } from "@/lib/format";
import {
  blockedDiverActions,
  crewClashPhase,
  departureClockOrder,
  ROLL_CALL_GAP_KINDS,
  rollCallGapUrgency,
  type TodayAction,
  urgencyFor,
} from "@/lib/today";
import type { TodayRowsContext } from "./today-rows-context";
import { at } from "./today-shared";
import type { BoatClash, CrewClash } from "./trips";

type ClockTrip = { id: string; title: string; startsAt: Date; boatId: string | null };

/**
 * The rows about who is not accounted for: blocked divers aboard a boat that is out, the open roll calls, and crew rostered on two boats at once. They lead the queue, so they are pushed first.
 */
export function pushRollCallRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { shopSlug, timeZone, locale, t, now } = ctx;
  const { rollCallGaps, crewClashState, boatsOut } = ctx.wave;
  const boatNameOf = (trip: ClockTrip) =>
    trip.boatId ? ctx.wave.boatNames.get(trip.boatId) : null;
  // Blocked divers aboard a boat that has left the horizon but is not back
  // (issue #2064). Only the boarded ones, and only as `blocked_aboard` rows:
  // an ashore blocker on a boat that has gone is noise.
  for (const trip of boatsOut.out) {
    const label = `${trip.title} · ${at(trip.startsAt, timeZone, locale)}`;
    const aboard = boatsOut.blocked
      .filter((row) => row.booking.tripId === trip.id)
      .map((row) => ({
        bookingId: row.booking.id,
        personId: row.person.id,
        fullName: row.person.fullName,
        tripId: trip.id,
        tripTitle: label,
        startsAt: trip.startsAt,
        blockers: row.readiness.blockers,
        aboard: true,
      }));
    // A diver whose only open blocker is money keeps no row here: that is the
    // one blocker that changes nothing in the water, and `blockedDiverActions`
    // would file it as an ordinary payment row for a boat nobody can reach.
    actions.push(
      ...blockedDiverActions(aboard, shopSlug, now, t).filter(
        (action) => action.kind === "blocked_aboard",
      ),
    );
  }

  // Somebody on a boat's list is not accounted for (DOM-H3). The after-dive
  // rows are the only ones on this queue that can mean a diver is still in the
  // water, so they lead: top `KIND_SEVERITY`, pinned to the top urgency band,
  // and dated at the moment the trip tied up — always in the past for a boat
  // that is home, so they also sort ahead of every still-upcoming row inside
  // that band. Urgency is set rather than derived because there is no "before
  // it sails" left to derive from; the departure it would hang off has already
  // happened.
  //
  // The dock-count rows (`departure_uncounted`, `no_roll_call`) ride the same
  // path with their own kind, tone, urgency and words — never the after-dive
  // wording. One string for both would say "a person may be in the water" on
  // every trip where two walk-aways were never tapped, and a warning that fires
  // on most trips is a warning nobody reads.
  for (const gap of rollCallGaps) {
    const checkpoint = gap.diveNumber >= 1 ? `after_dive_${gap.diveNumber}` : "departure";
    actions.push({
      id: `roll-call:${gap.tripId}:${gap.reason}:${checkpoint}`,
      kind: ROLL_CALL_GAP_KINDS[gap.reason],
      urgency: rollCallGapUrgency(gap.reason, gap.stale),
      subject: gap.title,
      // The safety-event timestamp format, with its timezone spelled out: a
      // bare time would read as "this morning" for a boat that returned last
      // night, which is the case this row exists for.
      context: formatDateTimeTz(gap.endsAt, locale, timeZone),
      // Its own header even when the same boat has morning work queued: the
      // return moment is a different moment than the departure.
      departure: {
        tripId: gap.tripId,
        label: `${gap.title} · ${formatDateTimeTz(gap.endsAt, locale, timeZone)}`,
      },
      aboutDeparture: true,
      // The owners were alerted (batch 6, item 6), and the shore contact too
      // (H-20261014-stale-roll-call-recipients; dive-domain re-review #7): said on the row the alert was
      // about, with its time in the shop's zone, so whoever opens Today knows
      // who has heard and when.
      detail: [rollCallGapDetailText(t, gap), rollCallAlertedText(t, gap, locale, timeZone)]
        .filter(Boolean)
        .join(" "),
      actionLabel: openRollCallActionText(t),
      // Straight to the checkpoint that is open, not the manifest's default
      // departure tab — one tap from the queue to the count that closes it.
      href: `/shop/${shopSlug}/trips/${gap.tripId}/manifest?checkpoint=${checkpoint}`,
      dueAt: gap.endsAt,
    });
  }

  // **Crew rostered on two departures at once** (H-20260916-may-one-hull-carry, issues #1776 and
  // #1814). A clash is the one crew fault invisible on both boats — each shows
  // a full crew list — so Today says it, on each of the two departures, in one
  // of two rows decided per leg by `crewClashPhase`:
  //
  // - `crew_clash` while the clashing leg is still to sail: there are hours
  //   left to ring somebody, and the fix is on the crew editor.
  // - `crew_clash_sailed` while it is out: the question from ashore is who is
  //   actually aboard, so it points at the roll call.
  //
  // Information, never a gate (#1345).
  //
  // **A missing diver always leads the sailed row** (dive-domain-expert review,
  // 2026-10-06). Needs you ranks tone first (`sortStationRows`), and every
  // after-dive roll-call row is danger where this row is a warning. The row is
  // also dated no earlier than the latest open after-dive count, so the
  // ordering holds on dates alone, should a tone ever move.
  const latestOpenAfterDiveCount = Math.max(
    0,
    ...rollCallGaps
      .filter((gap) => gap.diveNumber >= 1 && !gap.stale)
      .map((gap) => gap.endsAt.getTime()),
  );
  type ClashLeg = { clash: CrewClash; startsAt: Date };
  type SailedLeg = { clash: CrewClash; endsAt: Date };
  const standings = new Map<string, { ahead: ClashLeg[]; out: SailedLeg[] }>();
  for (const trip of crewClashState.departures) {
    const clashes = crewClashState.clashes.get(trip.id) ?? [];
    if (clashes.length === 0) continue;
    const crewAnswered = crewClashState.crew.get(trip.id) ?? new Map<string, string>();
    const recorded =
      [...(crewClashState.divers.get(trip.id)?.values() ?? [])].some(
        (state) => state === "boarded",
      ) || [...crewAnswered.values()].some((state) => state === "boarded");
    const ahead: ClashLeg[] = [];
    const out: SailedLeg[] = [];
    for (const clash of clashes) {
      const standing = crewClashPhase({
        legs: clash.legs,
        departureStartsAt: trip.startsAt,
        departureRollCallRecorded: recorded,
        now,
      });
      // Once this person has a result at this departure's own checkpoint,
      // "confirm who is aboard" is answered for them (review N2), so the
      // sailed row stops naming them.
      if (standing?.phase === "out" && !crewAnswered.has(clash.personId)) {
        out.push({ clash, endsAt: standing.leg.endsAt });
      }
      if (standing?.phase === "ahead") ahead.push({ clash, startsAt: standing.leg.startsAt });
    }
    standings.set(trip.id, { ahead, out });
  }
  // **Say each clash once** (issue #2211), as the staffing week does through
  // `sayEachClashOnce`: one person on two boats is one fact, and its row sits
  // on the earlier departure, naming the other. The later one drops a clash
  // only when the earlier one is saying it, so a partner outside this queue
  // (or already past "ahead") never silences the only row that says it.
  const startOrder = new Map(
    [...crewClashState.departures]
      .sort(departureClockOrder<ClockTrip>((trip) => trip.id, boatNameOf))
      .map((trip, index) => [trip.id, index]),
  );
  const sayAheadOnce = (tripId: string, ahead: readonly ClashLeg[]): ClashLeg[] =>
    ahead.filter(({ clash }) => {
      const partner = standings.get(clash.otherTripId);
      const partnerSaysIt = partner?.ahead.some(
        (leg) => leg.clash.personId === clash.personId && leg.clash.otherTripId === tripId,
      );
      if (!partnerSaysIt) return true;
      return (startOrder.get(tripId) ?? 0) < (startOrder.get(clash.otherTripId) ?? 0);
    });
  for (const trip of crewClashState.departures) {
    const standing = standings.get(trip.id);
    if (!standing) continue;
    const { out } = standing;
    const ahead = sayAheadOnce(trip.id, standing.ahead);
    const when = at(trip.startsAt, timeZone, locale);
    const departure = { tripId: trip.id, label: `${trip.title} · ${when}` };
    if (out.length > 0) {
      const returns = Math.max(...out.map((entry) => entry.endsAt.getTime()));
      actions.push({
        id: `crew-clash-sailed:${trip.id}`,
        kind: "crew_clash_sailed",
        urgency: "imminent",
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: crewClashSailedDetailText(
          t,
          locale,
          out.map((entry) => entry.clash),
        ),
        actionLabel: openRollCallActionText(t),
        href: `/shop/${shopSlug}/trips/${trip.id}/manifest`,
        dueAt: new Date(Math.max(returns, latestOpenAfterDiveCount)),
      });
    }
    if (ahead.length > 0) {
      const sails = new Date(Math.min(...ahead.map((entry) => entry.startsAt.getTime())));
      actions.push({
        id: `crew-clash:${trip.id}`,
        kind: "crew_clash",
        urgency: urgencyFor(sails, now),
        subject: trip.title,
        context: when,
        departure,
        aboutDeparture: true,
        detail: crewClashDetailText(
          t,
          locale,
          ahead.map((entry) => entry.clash),
        ),
        actionLabel: openCrewActionText(t),
        href: `/shop/${shopSlug}/trips/${trip.id}?view=details#crew`,
        dueAt: sails,
      });
    }
  }
}

/**
 * **One hull on two departures at once** (H-20260916-may-one-hull-carry, issue #2135), said once like
 * the crew clash (issue #2211): the row sits on the earlier departure and
 * names the other. A side goes quiet when its own leg has sailed
 * (`boatClashesByTrip`), so the later departure keeps the row whenever the
 * earlier one is not saying it. Information only; nothing is gated.
 */
export function pushBoatClashRows(actions: TodayAction[], ctx: TodayRowsContext): void {
  const { shopSlug, timeZone, locale, t, now } = ctx;
  const { departures, boatClashes } = ctx.wave.crewClashState;
  const boatNameOf = (trip: ClockTrip) =>
    trip.boatId ? ctx.wave.boatNames.get(trip.boatId) : null;
  // Same-minute departures by title, then id (issue #2788), as the spine
  // orders their stations: an id-only tiebreak hung the row on a different
  // boat each seed.
  const ordered = [...departures].sort(
    departureClockOrder<ClockTrip>((trip) => trip.id, boatNameOf),
  );
  const position = new Map(ordered.map((trip, index) => [trip.id, index]));
  for (const trip of ordered) {
    const standing: BoatClash[] = (boatClashes.get(trip.id) ?? []).filter((clash) => {
      const partnerSaysIt =
        position.has(clash.otherTripId) &&
        boatClashes.get(clash.otherTripId)?.some((other) => other.otherTripId === trip.id);
      if (!partnerSaysIt) return true;
      return (position.get(trip.id) ?? 0) < (position.get(clash.otherTripId) ?? 0);
    });
    if (standing.length === 0) continue;
    const when = at(trip.startsAt, timeZone, locale);
    actions.push({
      id: `boat-clash:${trip.id}`,
      kind: "boat_clash",
      urgency: urgencyFor(trip.startsAt, now),
      subject: trip.title,
      context: when,
      departure: { tripId: trip.id, label: `${trip.title} · ${when}` },
      aboutDeparture: true,
      detail: boatClashDetailText(t, standing),
      actionLabel: openTripActionText(t),
      href: `/shop/${shopSlug}/trips/${trip.id}?view=details`,
      dueAt: trip.startsAt,
    });
  }
}
