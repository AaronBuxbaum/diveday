import { and, eq } from "drizzle-orm";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { type fileScopedShopContext, seededShopContext } from "@/test/db";
import { mintCapability } from "./capabilities";
import type { DbExecutor } from "./client";
import { bookings, shops } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { claimCounterLink, waiverLinkDoor } from "./waivers-completion";
import { recordMedicalEvaluation as recordMedicalEvaluationInShop } from "./waivers-medical";
import { openWaiverInThread } from "./waivers-requests";
import { getCurrentWaiverTemplate } from "./waivers-templates";

/**
 * **What the waiver tests share**: the instant they sign at, the two
 * questionnaires (all clear, and one that refers to a physician), and the demo
 * departure's first seat with its template. Each `waivers-*.test.ts` sibling
 * runs against its own database (`fileScopedShopContext`) and binds
 * `waiverContext` to it with `waiverContextFor`.
 */

export const now = new Date("2026-07-18T12:00:00.000Z");

export const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
export const medicalReferralAnswers = {
  ...clearAnswers,
  responses: { ...clearAnswers.responses, q3: true },
};

/** Record a physician evaluation using the timezone currently stored for its shop. */
export async function recordMedicalEvaluationForShop(
  db: Parameters<typeof recordMedicalEvaluationInShop>[0],
  input: Omit<Parameters<typeof recordMedicalEvaluationInShop>[1], "timeZone">,
) {
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, input.shopId));
  if (!shop) throw new Error("medical evaluation shop missing");
  return recordMedicalEvaluationInShop(db, { ...input, timeZone: shop.timezone });
}

/**
 * The demo departure's first seat, its diver and the shop's current template,
 * read from the file's own database, or from a fresh one for the two tests that
 * cannot share a transaction (`fresh`).
 */
export function waiverContextFor(fileCtx: ReturnType<typeof fileScopedShopContext>) {
  return async ({ fresh = false } = {}) => {
    const { db, shop } = fresh ? await seededShopContext() : fileCtx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title === "Two-Tank Reef — Molasses & French");
    if (!trip) throw new Error("demo trip missing");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    if (!rosterEntry) throw new Error("demo booking missing");
    const template = await getCurrentWaiverTemplate(db, shop.id);
    if (!template) throw new Error("demo waiver template missing");
    // The diver the booking belongs to: `completeWaiver` now checks the typed
    // signature against this name, so every completion in these tests signs as
    // the person actually holding the seat.
    return {
      db,
      shop,
      trip,
      booking: rosterEntry.booking,
      person: rosterEntry.person,
      template,
    };
  };
}

/**
 * A counter tablet's link for one seat (`waiver_link`), the way
 * `issuePartyWaiver` makes it without the party: the seat's release opened as
 * its thread opens it, and a capability naming that release, minted at `now`.
 */
export async function issueCounterLink(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; now?: Date },
) {
  const [seat] = await db
    .select({ personId: bookings.personId, tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  if (!seat) throw new Error("counter link seat missing");
  const opened = await openWaiverInThread(db, {
    shopId: input.shopId,
    bookingId: input.bookingId,
    expectedPersonId: seat.personId,
    expectedTripId: seat.tripId,
    now: input.now,
  });
  if (!opened.ok) throw new Error(`counter link release refused: ${opened.reason}`);
  const link = await mintCapability(db, {
    purpose: "waiver_link",
    shopId: input.shopId,
    subjectId: opened.recordId,
    now: input.now,
  });
  if (!link.expiresAt) throw new Error("counter link without expiry");
  return { token: link.token, expiresAt: link.expiresAt, recordId: opened.recordId };
}

/** The secret each counter link's first phone keeps, by token (`claimCounterLink`). */
const claimedOnDevice = new Map<string, string>();

/**
 * What `/waivers/<token>` opens on the phone that opened the link first: the
 * first call for a token claims it, as the page's "open here" button does, and
 * every later call is that same phone reloading.
 */
export async function openOnDevice(db: DbExecutor, token: string, now?: Date) {
  let device = claimedOnDevice.get(token);
  if (!device) {
    device = (await claimCounterLink(db, token, now)) ?? undefined;
    if (device) claimedOnDevice.set(token, device);
  }
  return waiverLinkDoor(db, token, { device, now });
}

/** The secret the phone that opened `token` first keeps (`openOnDevice`), for a page test's cookie. */
export function claimedDevice(token: string): string | undefined {
  return claimedOnDevice.get(token);
}
