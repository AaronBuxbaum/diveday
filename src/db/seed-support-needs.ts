// i18n-exempt-file: seeded demo answers — the diver's own words about their own
// dive, the way a real one would type them, never app UI copy.
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { diveSupportNeeds } from "./schema";

/**
 * **One diver who arranged an accessible dive, and one who was asked and needs
 * nothing.**
 *
 * The demo's whole account of the support-needs record (ADR
 * 20260827-support-needs-are-a-record-about-the-dive), and deliberately small.
 * Adaptive diving is a real line for the shops this product is sold to, so a
 * demo with no such diver on the board says the software has no idea they
 * exist — and a demo where half the boat has arrangements says something just
 * as untrue in the other direction.
 *
 * The second row is the one that is easy to leave out and worth having: a
 * stated **zero**. It is a diver who was asked and said they need nobody, which
 * is a different fact from a diver nobody asked, and `stated_at` is the only
 * thing that tells the two apart. It renders nothing on any staff surface — and
 * that is the assertion, since a line saying "no support needed" beside a name
 * would be the absence of information formatted as information.
 */
export async function seedSupportNeeds(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
): Promise<void> {
  // Diego Alvarez and Nadia Petrov, by their index in `customerDefs` — the
  // same way `seed-rental-fit.ts` and `seed-nitrox.ts` name a diver. Both are
  // on today's reef boat (`customers.slice(0, 9)` in `seed-bookings.ts`), which
  // is the departure the prep and manifest surfaces are photographed on, so the
  // demo has something real to show on both. The person Diego names is Omar
  // Haddad, who is on that boat too: a constraint the buddy-team builder can
  // actually honour rather than a name from nowhere.
  const arranged = customers[3];
  const askedAndFine = customers[6];
  const rows: (typeof diveSupportNeeds.$inferInsert)[] = [];

  if (arranged) {
    rows.push({
      shopId,
      personId: arranged.id,
      supportDiversNeeded: 2,
      // The shop finds these two, so they land in the prep panel's "to arrange"
      // figure. A diver bringing their own would not.
      supportDiversProvidedBy: "shop",
      needsBoardingAssistance: true,
      needsWaterLift: true,
      briefingInWriting: true,
      briefingBySignals: true,
      equipmentAdaptation:
        "I bring my own webbed gloves and a short fin — nothing for you to find.",
      divesWithName: "Omar Haddad",
      statedAt: nowDate(),
    });
  }
  if (askedAndFine) {
    rows.push({ shopId, personId: askedAndFine.id, supportDiversNeeded: 0, statedAt: nowDate() });
  }
  if (rows.length > 0) await db.insert(diveSupportNeeds).values(rows);
}
