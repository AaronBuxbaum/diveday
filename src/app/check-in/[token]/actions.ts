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
import { kioskResponseWaitMs, kioskSelection, readKioskInput } from "@/lib/kiosk-check-in";
import { firstNameOf } from "@/lib/person-name";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
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
  // **The refusals are identical in words, and now in wall-clock time too.**
  // Reaching "see the desk" from a name nobody holds is one query; reaching the
  // same sentence from the one diver readiness refuses is a transaction, a row
  // lock and a readiness read — so response time distinguished "nobody by that
  // name is diving today" from "somebody is, and something is wrong with their
  // booking", which is the one thing this surface says nothing about (issue
  // #1608). Every path is held to the same floor, the success path included:
  // a floor on refusals alone would make *speed* the tell instead.
  //
  // `performance.now()` rather than the injectable clock: this measures elapsed
  // real time, and the e2e fleet freezes the clock at one instant, which would
  // make every answer look instantaneous and hold every one for the full floor.
  const startedAt = performance.now();
  const answer = await answerKioskSubmission(token, formData);
  const wait = kioskResponseWaitMs(performance.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return answer;
}

async function answerKioskSubmission(token: string, formData: FormData): Promise<KioskResult> {
  // **The wider of the two nets, and the only one an unresolvable token can
  // reach** (issue #1609). The per-link bucket below cannot be keyed until a
  // token has resolved, so a link that resolves to nothing used to cost
  // nothing: a stranger could spray guesses at the signature all afternoon,
  // paying one database read each and never touching a budget. Spending the
  // per-caller bucket first is what makes a guess cost something, and the
  // refusal skips the lookup entirely, so a spray is now cheaper for us than
  // for whoever is sending it.
  //
  // This lives here rather than in `kioskCheckInAction` on purpose: a refusal
  // raised in the wrapper would answer outside the timing floor and re-open the
  // side channel #1608 closed. Inside, it is held to the same floor as every
  // other answer, and it is the same `desk` card in the same words — nothing
  // distinguishes a spent bucket from an unknown link from a diver who is not
  // on a boat today.
  //
  // `clientIp()` returning null (local dev, a bare `next start`) collapses to
  // one shared "unknown" bucket, which is what its own docblock instructs.
  const ipBudget = await checkRateLimit(
    rateLimitKey("kiosk-ip", await clientIp()),
    RATE_LIMITS.kioskLookupByIp,
  );
  const db = await getDb();
  const display = ipBudget.allowed
    ? await verifyDisplayToken(db, { token, purpose: "check_in" })
    : null;
  const shop = display ? await getShopById(db, display.shopId) : null;
  // No shop resolved, so no shop locale to prefer.
  const locale = await requestLocale(shop?.defaultLocale);
  const t = diverTranslator(locale);
  // One sentence for everything this screen will not explain: a revoked link, a
  // link that was never ours, either rate limit, an unusable answer, no match,
  // several matches, a cancelled seat, and a diver readiness will not clear.
  const desk: KioskResult = {
    status: "desk",
    heading: t("kiosk.deskHeading"),
    body: t("kiosk.deskBody"),
  };
  // `!ipBudget.allowed` is stated rather than left to imply itself through the
  // null `display` above: this is the refusal, and a refusal that depends on a
  // reader noticing a ternary three lines up is one an edit can silently drop.
  if (!ipBudget.allowed || !display || !shop) return desk;

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
