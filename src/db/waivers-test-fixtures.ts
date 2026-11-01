import { eq } from "drizzle-orm";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { type fileScopedShopContext, seededShopContext } from "@/test/db";
import { shops } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { recordMedicalEvaluation as recordMedicalEvaluationInShop } from "./waivers-medical";
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
