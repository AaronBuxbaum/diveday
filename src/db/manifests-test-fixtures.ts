import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { getCurrentWaiverTemplate } from "./waivers";

// One seeded database for each importing test file and a rolled-back
// transaction per test. Two tests use `fresh: true` to verify transaction
// ordering without the file-scoped outer transaction.
export const ctx = fileScopedShopContext();

export const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

export async function manifestContext({ fresh = false }: { fresh?: boolean } = {}) {
  const { db, shop } = fresh ? await seededShopContext() : ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [booking] = await getTripRoster(db, shop.id, reef.id);
  if (!booking) throw new Error("demo booking missing");
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!template) throw new Error("demo waiver template missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, reef, booking, template, staff: staff.person };
}
