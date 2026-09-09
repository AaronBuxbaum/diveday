"use server";

import { checkInAtKiosk } from "@/db/check-in";
import { getDb } from "@/db/client";
import { verifyDisplayToken } from "@/db/display-tokens";
import { findKioskSeats } from "@/db/kiosk-check-in";
import { getShopById } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { formatTime } from "@/lib/format";
import { kioskSelection, readKioskInput } from "@/lib/kiosk-check-in";
import { firstNameOf } from "@/lib/person-name";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import type { KioskResult } from "./kiosk-types";

/**
 * **The counter tablet's one act** (N-24): look this person up on today's
 * departures and, if they are cleared, record that they have arrived.
 *
 * Lookup and arrival are one submission on purpose. Two steps would mean a
 * screen listing who was found, which is the disclosure this surface is built
 * to not be; and the whole promise of a kiosk is that a diver types a name and
 * is done.
 *
 * **The token arrives as a bound argument, never from the form.** It is the
 * capability, and a form field would let anyone with the page open swap in
 * another shop's link.
 *
 * **Nothing about the answer is written to the URL**, and the result lives only
 * in the client's `useActionState`. A shared tablet must not leave the previous
 * diver's name in its address bar, its history, or a bookmark — and the console
 * clears itself after a few seconds, so it does not leave it on the glass
 * either.
 */
export async function kioskCheckInAction(
  token: string,
  _previous: KioskResult,
  formData: FormData,
): Promise<KioskResult> {
  const db = await getDb();
  const display = await verifyDisplayToken(db, { token, purpose: "check_in" });
  const shop = display ? await getShopById(db, display.shopId) : null;
  // No shop resolved, so no shop locale to prefer.
  const locale = await requestLocale(shop?.defaultLocale);
  const t = diverTranslator(locale);
  // One sentence for everything this screen will not explain: a revoked link, a
  // link that was never ours, a rate limit, an unusable answer, no match,
  // several matches, a cancelled seat, and a diver readiness will not clear.
  const desk: KioskResult = {
    status: "desk",
    heading: t("kiosk.deskHeading"),
    body: t("kiosk.deskBody"),
  };
  if (!display || !shop) return desk;

  const budget = await checkRateLimit(
    rateLimitKey("kiosk-lookup", display.id),
    RATE_LIMITS.kioskLookup,
  );
  if (!budget.allowed) return desk;

  const lookup = readKioskInput(formData.get("who"));
  if (!lookup) return desk;

  const now = nowDate();
  const seat = kioskSelection(await findKioskSeats(db, { shopId: shop.id, lookup, now }));
  if (!seat) return desk;

  const outcome = await checkInAtKiosk(db, {
    shopId: shop.id,
    displayTokenId: display.id,
    bookingId: seat.bookingId,
    now,
  });
  if (!outcome.ok) return desk;

  const meetingPoint = seat.meetingPointLabel ?? seat.meetingPointAddress;
  return {
    status: "ready",
    // A first name, not the whole one: enough for the diver to know the screen
    // means them, and the least this surface can say and still be checkable by
    // the person standing in front of it.
    heading: t(outcome.alreadyArrived ? "kiosk.readyAgain" : "kiosk.ready", {
      // The stored name is the fallback rather than a word of our own: it is
      // `not null` and trimmed by every writer, so the fallback is unreachable,
      // and a sentence invented for an unreachable state is a sentence to
      // delete (AGENTS.md).
      name: firstNameOf(outcome.personName, outcome.personName),
    }),
    lines: [
      t("kiosk.departure", {
        title: seat.tripTitle,
        time: formatTime(seat.startsAt, locale, shop.timezone),
      }),
      ...(meetingPoint ? [t("kiosk.meetAt", { place: meetingPoint })] : []),
    ],
  };
}
