import type { AppDb } from "@/db/client";
import { countShopTrips } from "@/db/trips";
import { carryInterests } from "@/features/bookings/interest-roll";
import { revalidateAndRedirect } from "@/features/platform/navigation";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { TripDetailsResult } from "@/lib/trip-details";
import { uuidParam } from "@/lib/uuid";

const boardPath = (shopSlug: string) => shopPath(shopSlug, "schedule", "board");

/**
 * **Carry the wait list on add** (#2559). The add panel opened from a full
 * departure's demand banner carries that departure's id (`carryFrom`); once the
 * new departure exists, every interest still waiting on the source is copied to
 * it and the staffer lands on it with the `waitlist-carried` notice, so adding
 * the boat and walking away no longer strands the divers waiting. Nobody is
 * messaged here, as with the roster's own carry form.
 *
 * The id is navigation context, not authority: `carryInterests` reads both
 * departures inside this shop and refuses a different course. A refusal
 * changes nothing and falls through to the ordinary landing, where the
 * source's own "Carry the wait list" form still stands.
 */
async function landCarryingWaitlist(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  toTripId: string,
  formData: FormData,
  keepBoardNotice = false,
): Promise<void> {
  const carryFrom = formData.get("carryFrom");
  const fromTripId = typeof carryFrom === "string" ? uuidParam(carryFrom) : undefined;
  if (!fromTripId) return;
  const carried = await carryInterests(db, { shopId, fromTripId, toTripId });
  if (!carried.ok || keepBoardNotice) return;
  const landing = shopPath(shopSlug, "trips", toTripId);
  revalidateAndRedirect(
    landing,
    noticeUrl(landing, "waitlist-carried", { count: carried.carried }),
  );
}

/**
 * Where a staff member lands once the departure is on the board: back on the
 * board, on the week the new departure sails in (`week`), with the departure
 * named in the notice. Added for a date in another week, it would otherwise
 * land on this one and the new departure would be out of view.
 *
 * The exception is a shop's first departure ever, which hands over to Today's
 * `FirstBookableCard`. "First" must stay *exactly* the home page's own test
 * (`src/app/shop/[shopSlug]/page.tsx`) — total equals what was just created,
 * demo shops excluded — or one of the two renders a card the other denies.
 */
export async function landAfterAdd(
  db: AppDb,
  shop: { id: string; isDemo: boolean },
  shopSlug: string,
  title: string,
  createdCount: number,
  createdTripId: string,
  formData: FormData,
  crewIncomplete = false,
): Promise<never> {
  await landCarryingWaitlist(db, shop.id, shopSlug, createdTripId, formData, crewIncomplete);
  const back = boardPath(shopSlug);
  const firstBookableMoment =
    !shop.isDemo && (await countShopTrips(db, shop.id)) === Math.max(createdCount, 1);
  if (firstBookableMoment && !crewIncomplete) {
    const home = `/shop/${shopSlug}`;
    const query = new URLSearchParams({ created: title });
    if (createdCount > 1) query.set("series", String(createdCount));
    revalidateAndRedirect(home, `${home}?${query.toString()}`);
  }
  const query = new URLSearchParams({
    builder: crewIncomplete ? "added-no-crew" : "added",
    created: title,
  });
  // The form's date, which the add already read and accepted: the new departure's first day.
  const date = formData.get("date");
  if (typeof date === "string" && isValidCalendarDate(date)) query.set("week", date);
  if (createdCount > 1) query.set("series", String(createdCount));
  revalidateAndRedirect(back, `${back}?${query.toString()}`);
}

/**
 * Where a refused add lands: the builder notice that names the reason, and
 * the outcome analytics counts it under. Null for a refusal with no sentence
 * of its own, which lands on the generic "invalid".
 */
export function addRefusalLanding(refusal: Exclude<TripDetailsResult, { ok: true }>): {
  builder: string;
  outcome: "invalid" | "capacity_above_certificate" | "end_before_start";
} | null {
  switch (refusal.reason) {
    case "capacity_above_certificate":
      return {
        builder: `capacity-above-certificate&count=${refusal.limit}`,
        outcome: "capacity_above_certificate",
      };
    case "end_before_start":
      return { builder: "end-before-start", outcome: "end_before_start" };
    case "days_out_of_order":
      return { builder: "days-out-of-order", outcome: "invalid" };
    default:
      return null;
  }
}
