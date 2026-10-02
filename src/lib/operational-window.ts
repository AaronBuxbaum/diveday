/**
 * One time-window model for the shop's readiness surfaces.
 *
 * The shop home, the "Not ready" queue and Check-in all read the same
 * evidence — who can't board yet — and used to slice it on three unrelated,
 * page-side horizons: "the next 7 days", "the nearest 40 departures", and
 * "−6h → +36h". A diver cleared on one list still showed on another, and no
 * staffer could hold one mental model of what any of the three was promising.
 *
 * This module is that model. Every readiness surface derives its bounds from
 * here, so the three horizons agree *by construction* rather than by anyone
 * remembering to keep three constants in step:
 *
 * - **The operational horizon** (`operationalWindow`) — now through
 *   {@link OPERATIONAL_HORIZON_DAYS} days out. The shop's working week. The
 *   home files the work inside it onto the boat each job holds up, and
 *   everything further out is Schedule's job rather than a triage list's.
 * - **The shop day** (`shopDayWindow`) — the coarse scan that finds "today's
 *   boat" before a timezone is applied. Not a readiness lens at all: it exists
 *   only so a *calendar-day* question can be answered without reading every
 *   scheduled trip the shop has ever had. See its own note below.
 * - **The arrivals window** (`arrivalsWindow`) — the counter's narrower lens on
 *   the *same* horizon: departures from {@link ARRIVALS_LOOKBACK_HOURS} hours
 *   ago through the next {@link ARRIVALS_AHEAD_HOURS}. It reaches backwards,
 *   which the operational horizon deliberately does not: a diver can still walk
 *   up to a counter for a boat that has already sailed, and the front desk needs
 *   that row. Forwards it never outruns the horizon — see
 *   `arrivalsWindowIsInsideHorizon`, which is what guarantees the counter can
 *   never show a departure the home has already dropped.
 *
 * Reports is deliberately *not* here. A calendar month is genuinely its job.
 *
 * Codes and numbers only — the sentence that discloses the window lives in
 * the staff bundle under `shared.operationalWindow`, parameterised from the
 * constants below so the words can never drift from the query. It names the
 * counter alone now: "Not ready" became a view of the shop home
 * (ADR 20260803-not-ready-is-a-view) and then stopped being a view at all when
 * the home became one chronological spine (ADR
 * 20260827-clearwater-surface-language, decision 4). The *lenses* on the window
 * are unchanged, and so is everything in this module.
 */

import { DAY_MS, HOUR_MS } from "@/lib/clock";

/**
 * How far ahead every readiness surface looks. A working week: long enough that
 * a waiver chased today still lands before the boat, short enough that the list
 * stays a list of work rather than a second schedule.
 */
export const OPERATIONAL_HORIZON_DAYS = 7;

export const OPERATIONAL_HORIZON_MS = OPERATIONAL_HORIZON_DAYS * DAY_MS;

/**
 * How far *back* the counter looks. A boat that left this morning still has
 * divers arriving at the desk with questions; dropping it the moment it sails
 * is what sends staff hunting through Schedule mid-rush.
 */
export const ARRIVALS_LOOKBACK_HOURS = 6;

/** How far ahead the counter looks: today's remaining boats plus tomorrow's. */
export const ARRIVALS_AHEAD_HOURS = 36;

/**
 * How far the shop-day scan reaches either side of now (see
 * {@link shopDayWindow}).
 *
 * The bound is not a guess: **26 hours is what the shop's own calendar day can
 * actually span relative to any instant inside it.** At 23:59 local, local
 * midnight this morning is nearly 24 hours behind; at 00:00 local, tonight's
 * last departure is nearly 24 hours ahead. The extra two hours absorb a
 * daylight-saving transition, which makes a local day 25 hours long, plus an
 * hour of slack.
 *
 * It replaces a freestanding, asymmetric −18h/+30h that this query carried
 * inline. The forward half was ample; the *backward* half was six hours short
 * of the shop's own morning, so a shop's 03:00 boat stopped being "today's
 * boat" from 21:00 local onwards — on the same day it sailed.
 */
export const SHOP_DAY_SCAN_HOURS = 26;

/**
 * How many upcoming departures any readiness surface will inspect. Readiness is
 * a per-trip roll-up, so this bounds the work in the pathological case (a shop
 * with dozens of departures inside one week). The horizon, not this number, is
 * what normally decides the list — this only stops an unbounded query, and a
 * surface that hits it says so rather than truncating in silence.
 */
export const OPERATIONAL_MAX_TRIPS = 60;

/** A half-open-in-spirit interval of departure times. Both bounds inclusive. */
export type OperationalWindow = {
  from: Date;
  to: Date;
};

/**
 * The horizon every readiness surface shares: departures from this moment
 * through {@link OPERATIONAL_HORIZON_DAYS} days out.
 */
export function operationalWindow(now: Date): OperationalWindow {
  return { from: now, to: new Date(now.getTime() + OPERATIONAL_HORIZON_MS) };
}

/**
 * The counter's lens on the same horizon: recently-sailed and imminent
 * departures only. Never wider than {@link operationalWindow} going forward.
 */
export function arrivalsWindow(now: Date): OperationalWindow {
  return {
    from: new Date(now.getTime() - ARRIVALS_LOOKBACK_HOURS * HOUR_MS),
    to: new Date(now.getTime() + ARRIVALS_AHEAD_HOURS * HOUR_MS),
  };
}

/**
 * The loose UTC net around "the shop's own calendar day", for the one question
 * that is about a *date* rather than a horizon: which boat would staff check in
 * for right now (`todayNextDepartureTripId`, `src/db/today.ts`, which feeds the
 * command palette's "Boarding — today's boat" jump).
 *
 * It is deliberately **not** a readiness lens and never bounds one. It is a
 * query bound: SQL cannot ask "same calendar day in Asia/Jayapura" of a UTC
 * column, so the scan over-fetches by {@link SHOP_DAY_SCAN_HOURS} either side
 * and the caller keeps only the rows whose shop-local date matches. Widening it
 * costs rows; narrowing it silently loses a real departure — which is exactly
 * why the number lives here, derived and explained, rather than inline in a
 * query where nobody could check it (and where, as it turned out, nobody had).
 */
export function shopDayWindow(now: Date): OperationalWindow {
  return {
    from: new Date(now.getTime() - SHOP_DAY_SCAN_HOURS * HOUR_MS),
    to: new Date(now.getTime() + SHOP_DAY_SCAN_HOURS * HOUR_MS),
  };
}

/** Whether a departure time falls inside a window. Both bounds inclusive. */
export function withinWindow(window: OperationalWindow, at: Date): boolean {
  return at.getTime() >= window.from.getTime() && at.getTime() <= window.to.getTime();
}

/**
 * The containment invariant the three surfaces rest on: anything the counter
 * shows *ahead of now* is inside the operational horizon, so a departure can
 * never reach Check-in without also being visible on the home. The
 * arrivals window's lookback intentionally sits outside it — see the module
 * note.
 */
export function arrivalsWindowIsInsideHorizon(now: Date): boolean {
  return arrivalsWindow(now).to.getTime() <= operationalWindow(now).to.getTime();
}
