"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  checkOutTripGearSet,
  type GearReservationActionOutcome,
  type ReserveGearUnitOutcome,
  releaseGearReservation,
  reserveGearUnit,
  returnTripGearSet,
} from "@/db/gear";
import { getShopById } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { GEAR_RETURN_OUTCOMES, tripReservationWindow } from "@/lib/gear";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { type NoticeCodeOf, noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * A gear refusal's `?notice=` code, one entry per reason the domain can answer.
 *
 * These used to be built as `` `gear-${outcome.reason}` ``. Every code that
 * produced happened to exist in the prep page's `GEAR_NOTICES` map — but
 * `scripts/check-notice-codes.mjs` cannot read an interpolated string, so
 * nothing checked it, and a reason added to either union tomorrow would have
 * produced a code with no map entry. That renders **no banner at all**, which
 * looks exactly like a dead link and fails nothing.
 *
 * The value type is a template over `NoticeCodeOf`, so each entry is pinned to
 * exactly one spelling: the domain layer says `unit_out_of_service` and the URL
 * must say `gear-unit-out-of-service`. A typo is a compile error rather than a
 * silent blank, and the literals are now greppable from the page that resolves
 * them.
 */
type GearRefusalOf<Outcome> =
  Extract<Outcome, { ok: false }> extends { reason: infer R extends string } ? R : never;

type GearNoticeTable<Reason extends string> = {
  [R in Reason]: `gear-${NoticeCodeOf<R>}`;
};

const RESERVE_GEAR_NOTICE: GearNoticeTable<GearRefusalOf<ReserveGearUnitOutcome>> = {
  not_found: "gear-not-found",
  booking_not_found: "gear-booking-not-found",
  invalid_window: "gear-invalid-window",
  unit_out_of_service: "gear-unit-out-of-service",
  unit_unavailable: "gear-unit-unavailable",
};

const RESERVATION_ACTION_NOTICE: GearNoticeTable<GearRefusalOf<GearReservationActionOutcome>> = {
  not_found: "gear-not-found",
  already_returned: "gear-already-returned",
  already_checked_out: "gear-already-checked-out",
  concern_needs_words: "gear-concern-needs-words",
};

const assignSchema = z.object({
  tripId: z.uuid(),
  bookingId: z.uuid(),
  gearItemId: z.uuid(),
});

/**
 * Assign one unit to one diver for this departure's whole window. The window
 * is derived from the trip on the server — never posted from the form — so a
 * stale tab cannot reserve last week's dates, and the exclusion constraint
 * stays the only arbiter of availability (ADR 20260815-minimal-gear-register).
 */
export async function assignGearUnitAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = assignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const gear = shopPath(session.user.shopSlug, "gear");
    revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  }
  const prep = shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep");

  const db = await getDb();
  const [shop, trip] = await Promise.all([
    getShopById(db, session.user.shopId),
    getTripWithBooked(db, session.user.shopId, parsed.data.tripId),
  ]);
  if (!shop || !trip) revalidateAndRedirect(prep, noticeUrl(prep, "gear-invalid"));

  const window = tripReservationWindow(trip, shop.timezone);
  const outcome = await reserveGearUnit(db, {
    shopId: shop.id,
    gearItemId: parsed.data.gearItemId,
    bookingId: parsed.data.bookingId,
    // Pins the booking to this departure: the window above is this trip's, so
    // a stale tab pairing it with another trip's booking must be refused.
    tripId: parsed.data.tripId,
    reservedFrom: window.from,
    reservedUntil: window.until,
  });
  revalidateAndRedirect(
    prep,
    noticeUrl(prep, outcome.ok ? "gear-assigned" : RESERVE_GEAR_NOTICE[outcome.reason]),
  );
}

/**
 * What a row learns when it commits its own pick — a **code**, never a
 * sentence; the row picks the words (ADR 20260731-domain-layer-copy-leaks).
 */
export type AssignGearUnitResult =
  | { ok: true }
  | { ok: false; reason: GearRefusalOf<ReserveGearUnitOutcome> | "invalid" };

/**
 * **The same assignment, answered rather than redirected.**
 *
 * `assignGearUnitAction` above redirects with a `?notice=`, which is right for
 * a form: one act, one page, one banner. This surface is twenty-one acts in a
 * row at a counter on the morning of a departure, and a redirect per row means
 * the page reloads under the staffer twenty-one times and says what happened
 * in a banner at the top, away from the row that did it.
 *
 * So the picker commits on change and this hands the outcome back, letting the
 * row revert its own select and say why on the spot (issue #802,
 * docs/design/principles.md §10's "edit in place where safe").
 *
 * **Every guard the redirecting twin has, in the same order** — the session,
 * the same parse, the shop and trip re-read by `session.user.shopId` rather
 * than by anything the client sent, the window computed here from the trip
 * row, and `tripId` pinned into the reservation so a stale tab cannot pair
 * this trip's window with another trip's booking. Availability is still never
 * pre-checked: the double-booking refusal arrives from the exclusion
 * constraint inside `reserveGearUnit`, which is the only thing that can be
 * true at write time.
 */
export async function assignGearUnit(input: {
  tripId: string;
  bookingId: string;
  gearItemId: string;
}): Promise<AssignGearUnitResult> {
  const session = await requireStaffSession();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const db = await getDb();
  const [shop, trip] = await Promise.all([
    getShopById(db, session.user.shopId),
    getTripWithBooked(db, session.user.shopId, parsed.data.tripId),
  ]);
  if (!shop || !trip) return { ok: false, reason: "invalid" };

  const window = tripReservationWindow(trip, shop.timezone);
  const outcome = await reserveGearUnit(db, {
    shopId: shop.id,
    gearItemId: parsed.data.gearItemId,
    bookingId: parsed.data.bookingId,
    tripId: parsed.data.tripId,
    reservedFrom: window.from,
    reservedUntil: window.until,
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  // The rest of the page holds counts and a "still to assign" list that this
  // pick just changed, so the server tree is refreshed — without the redirect
  // that would throw the staffer back to the top of a long page.
  revalidatePath(shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep"));
  return { ok: true };
}

const releaseSchema = z.object({ tripId: z.uuid(), reservationId: z.uuid() });

/** Un-assign a unit that never left the counter; an out unit gets returned instead. */
export async function releaseGearUnitAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = releaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const gear = shopPath(session.user.shopSlug, "gear");
    revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  }
  const prep = shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep");

  const outcome = await releaseGearReservation(await getDb(), {
    shopId: session.user.shopId,
    reservationId: parsed.data.reservationId,
  });
  revalidateAndRedirect(
    prep,
    noticeUrl(prep, outcome.ok ? "gear-released" : RESERVATION_ACTION_NOTICE[outcome.reason]),
  );
}

const gearSetSchema = z.object({ tripId: z.uuid(), bookingId: z.uuid() });

/**
 * **Hand one diver's whole rental set across in one act** (issue #1185,
 * delight report D25).
 *
 * The mirror of `returnTripGearSetAction` below, and deliberately the plainer
 * of the two: a hand-over asks nothing, because the moment a diver walks off
 * with their armful there is nothing yet to say about how it went.
 *
 * A set with nothing left on the wall answers `not_found`, worded here as the
 * set already being out rather than as a missing record — the same trade the
 * return path makes, and for the same reason: on this page the reservations
 * are visibly there.
 */
export async function checkOutTripGearSetAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = gearSetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const gear = shopPath(session.user.shopSlug, "gear");
    revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  }
  const prep = shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep");

  const outcome = await checkOutTripGearSet(await getDb(), {
    shopId: session.user.shopId,
    bookingId: parsed.data.bookingId,
  });
  revalidateAndRedirect(
    prep,
    noticeUrl(
      prep,
      outcome.ok
        ? "gear-handed-over"
        : outcome.reason === "not_found"
          ? "gear-nothing-to-hand-over"
          : RESERVATION_ACTION_NOTICE[outcome.reason],
    ),
  );
}

const returnSetSchema = gearSetSchema.extend({
  outcome: z.enum(GEAR_RETURN_OUTCOMES),
  note: z.string().trim().max(400).optional(),
});

/**
 * **Bring one diver's whole rental set home, with how it went** (issue #1186,
 * delight report D26).
 *
 * The set rather than the piece, because that is what a counter is handed: an
 * armful, at 4pm, by somebody who wants to go home. Asking for an outcome per
 * unit is the paperwork this replaces.
 *
 * The note is bounded here and *required* by the domain writer when the outcome
 * is a service concern — the refusal lives there rather than in this schema so
 * the same rule holds for the single-unit path on the register.
 *
 * A set with nothing out answers `not_found`, which the prep page words as
 * "nothing from that set is out" rather than as a missing record: on this
 * surface the reservation plainly exists, and the honest thing to say is that
 * somebody else already brought it back.
 */
export async function returnTripGearSetAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = returnSetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const gear = shopPath(session.user.shopSlug, "gear");
    revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  }
  const prep = shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep");

  const outcome = await returnTripGearSet(await getDb(), {
    shopId: session.user.shopId,
    bookingId: parsed.data.bookingId,
    outcome: parsed.data.outcome,
    note: parsed.data.note,
  });
  revalidateAndRedirect(
    prep,
    noticeUrl(
      prep,
      outcome.ok
        ? "gear-returned-set"
        : outcome.reason === "not_found"
          ? "gear-nothing-out"
          : RESERVATION_ACTION_NOTICE[outcome.reason],
    ),
  );
}
