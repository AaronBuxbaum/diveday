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
import { getTripWithBooked, screenGearPicks } from "@/db/trips";
import { PREP_SECTION_ID } from "@/lib/element-id";
import { GEAR_RETURN_OUTCOMES, tripReservationWindow } from "@/lib/gear";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { type NoticeCodeOf, noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * A gear refusal's `?notice=` code, one entry per reason the domain can answer.
 *
 * These used to be built as `` `gear-${outcome.reason}` ``. Every code that
 * produced happened to exist in the packing list's `GEAR_NOTICES` map — but
 * `scripts/check-notice-codes.mjs` cannot read an interpolated string, so
 * nothing checked it, and a reason added to either union tomorrow would have
 * produced a code with no map entry. That renders **no banner at all**, which
 * looks exactly like a dead link and fails nothing.
 *
 * The value type is a template over `NoticeCodeOf`, so each entry is pinned to
 * exactly one spelling: the domain layer says `already_checked_out` and the URL
 * must say `gear-already-checked-out`. A typo is a compile error rather than a
 * silent blank, and the literals are now greppable from the page that resolves
 * them.
 */
type GearRefusalOf<Outcome> =
  Extract<Outcome, { ok: false }> extends { reason: infer R extends string } ? R : never;

type GearNoticeTable<Reason extends string> = {
  [R in Reason]: `gear-${NoticeCodeOf<R>}`;
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
  proposed: z.boolean().optional(),
  assignAnyway: z.boolean().optional(),
});

/**
 * **Where a gear form lands its staffer: the departure's Gear tab.**
 *
 * The packing list is the Gear tab (ADR 20261001-logbook, decision 3), so that
 * is where these forms are submitted from and where their `?notice=` belongs.
 *
 * One helper rather than five call sites, because the five must agree: a
 * redirect and the `revalidatePath` beside it naming different paths is a
 * staffer watching a stale count.
 */
function departureOf(shopSlug: string, tripId: string) {
  return shopPath(shopSlug, "trips", tripId, "prep");
}

/**
 * The Gear tab, landing on the list rather than the top of the page: a counter
 * working down twenty-one divers at 06:15 gets the section they tapped in, with
 * the answer to that tap in it (dive-domain review 20260920).
 * `revalidatePath` takes the bare path: a fragment is the browser's business
 * and names no route.
 */
function packingListOf(shopSlug: string, tripId: string) {
  return `${departureOf(shopSlug, tripId)}#${PREP_SECTION_ID}`;
}

/**
 * What a row learns when it commits its own pick — a **code**, never a
 * sentence; the row picks the words (ADR 20260731-domain-layer-copy-leaks).
 */
export type AssignGearUnitResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * `not_wanted`: the diver never asked for that kind.
       * `already_holds_kind`: the diver already holds one of that kind.
       * `identity_held`: the seat is held until the desk confirms who it is.
       * `needs_care_confirm`: a hand-picked life-support unit needs care; the
       * row offers "Assign anyway". `needs_care`: a proposed unit gained a lapsed clock or an open
       * service concern since the page loaded.
       */
      reason: GearRefusalOf<ReserveGearUnitOutcome> | "invalid" | "not_wanted";
    };

/**
 * **Assign one unit to one diver for this departure's whole window, answered
 * rather than redirected.**
 *
 * This surface is twenty-one acts in a row at a counter on the morning of a
 * departure, and a redirect per row would reload the page under the staffer
 * twenty-one times and say what happened in a banner at the top, away from
 * the row that did it. So the picker commits on change and this hands the
 * outcome back, letting the row revert its own select and say why on the spot
 * (issue #802, docs/design/principles.md §10's "edit in place where safe").
 *
 * The guards, in order: the session, the parse, the shop and trip re-read by
 * `session.user.shopId` rather than by anything the client sent, the pick held
 * to what the departure still wants (`screenGearPicks`, the door a stale Gear
 * tab's picker and proposed rows reach), the window computed here from the
 * trip row (never posted from the form, so a stale tab cannot reserve last
 * week's dates), and `tripId` pinned into the reservation so a stale tab
 * cannot pair this trip's window with another trip's booking. Availability is
 * never pre-checked: the double-booking refusal arrives from the exclusion
 * constraint inside `reserveGearUnit`, which is the only thing that can be
 * true at write time (ADR 20260815-minimal-gear-register).
 *
 * `proposed` says the pick is the row's proposal rather than a unit a person
 * chose from the picker. A proposed pick is also re-read for care, and one
 * whose unit has since gained a lapsed clock or an open service concern is
 * refused (`needs_care`). A hand pick may still knowingly choose a labeled
 * unit, the dock decides (H-06), but a life-support unit asks first
 * (`needs_care_confirm`) and goes through only with `assignAnyway`.
 */
export async function assignGearUnit(input: {
  tripId: string;
  bookingId: string;
  gearItemId: string;
  proposed?: boolean;
  assignAnyway?: boolean;
}): Promise<AssignGearUnitResult> {
  const session = await requireStaffSession();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const db = await getDb();
  const [shop, trip] = await Promise.all([
    getShopById(db, session.user.shopId),
    getTripWithBooked(db, session.user.shopId, parsed.data.tripId),
  ]);
  if (!shop || !trip || trip.status === "cancelled") return { ok: false, reason: "invalid" };
  // The same screen "Assign all" uses (`screenGearPicks`): a stale tab cannot
  // give a diver a second unit of a kind they already hold, nor reserve a
  // proposed unit whose care changed since the page loaded.
  const pick = {
    bookingId: parsed.data.bookingId,
    gearItemId: parsed.data.gearItemId,
  };
  const screened = await screenGearPicks(db, shop, parsed.data.tripId, [pick], {
    proposed: parsed.data.proposed === true,
  });
  if (screened.held > 0) return { ok: false, reason: "identity_held" };
  if (screened.needsCare > 0) return { ok: false, reason: "needs_care" };
  if (screened.alreadyHeld > 0) return { ok: false, reason: "already_holds_kind" };
  if (screened.kept.length === 0) return { ok: false, reason: "not_wanted" };

  const window = tripReservationWindow(trip, shop.timezone);
  // The screen again, under the booking's row lock and in the write's own
  // transaction: a second tablet that passed the screen above at the same
  // instant is refused here rather than handed a second unit (issue #2215).
  const outcome = await reserveGearUnit(db, {
    shopId: shop.id,
    gearItemId: parsed.data.gearItemId,
    bookingId: parsed.data.bookingId,
    tripId: parsed.data.tripId,
    reservedFrom: window.from,
    reservedUntil: window.until,
    screen: {
      proposed: parsed.data.proposed === true,
      assignAnyway: parsed.data.assignAnyway === true,
    },
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  // The rest of the page holds counts and a "still to assign" list that this
  // pick just changed, so the server tree is refreshed — without the redirect
  // that would throw the staffer back to the top of a long page.
  revalidatePath(departureOf(session.user.shopSlug, parsed.data.tripId));
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
  const departure = departureOf(session.user.shopSlug, parsed.data.tripId);
  const landing = packingListOf(session.user.shopSlug, parsed.data.tripId);

  const outcome = await releaseGearReservation(await getDb(), {
    shopId: session.user.shopId,
    reservationId: parsed.data.reservationId,
    releasedByPersonId: session.user.personId,
  });
  revalidateAndRedirect(
    departure,
    noticeUrl(landing, outcome.ok ? "gear-released" : RESERVATION_ACTION_NOTICE[outcome.reason]),
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
  const departure = departureOf(session.user.shopSlug, parsed.data.tripId);
  const landing = packingListOf(session.user.shopSlug, parsed.data.tripId);

  const outcome = await checkOutTripGearSet(await getDb(), {
    shopId: session.user.shopId,
    bookingId: parsed.data.bookingId,
  });
  revalidateAndRedirect(
    departure,
    noticeUrl(
      landing,
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
 * A set with nothing out answers `not_found`, which the packing list words as
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
  const departure = departureOf(session.user.shopSlug, parsed.data.tripId);
  const landing = packingListOf(session.user.shopSlug, parsed.data.tripId);

  // The units ticked "Needs service" under a concern (issue #2205): a repeated
  // field, so it is read on its own rather than through `fromEntries`. Anything
  // that is not a unit id is dropped; the writer only reaches units this
  // return closes, so a forged id pulls nothing.
  const pullGearItemIds = formData
    .getAll("pull")
    .filter((value): value is string => typeof value === "string")
    .filter((value) => z.uuid().safeParse(value).success);
  const outcome = await returnTripGearSet(await getDb(), {
    shopId: session.user.shopId,
    bookingId: parsed.data.bookingId,
    outcome: parsed.data.outcome,
    note: parsed.data.note,
    pullGearItemIds,
  });
  revalidateAndRedirect(
    departure,
    noticeUrl(
      landing,
      outcome.ok
        ? // "Back on the wall" would be wrong about a unit just pulled for service.
          parsed.data.outcome === "service_concern" && pullGearItemIds.length > 0
          ? "gear-returned-set-pulled"
          : "gear-returned-set"
        : outcome.reason === "not_found"
          ? "gear-nothing-out"
          : RESERVATION_ACTION_NOTICE[outcome.reason],
    ),
  );
}
