import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { SAMPLE_PROFILE } from "@/lib/dive-profile-sample";
import { seededShopContext } from "@/test/db";
import { loadShopExportBundleInput } from "./export";
import { table } from "./export-bundle-table.test-support";
import { bookings, computerDiveProfiles, computerDives, computerImportBatches } from "./schema";
import { DEMO_RECAP_BOOKING_ID } from "./seed-identifiers";

it("exports the demo recap diver's seeded computer import and profile", async () => {
  // A fresh seeded database, not a shared test's previous import.
  const { db, shop } = await seededShopContext({ history: true });
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, DEMO_RECAP_BOOKING_ID));
  if (!booking) throw new Error("demo recap booking missing");
  const batches = await db
    .select()
    .from(computerImportBatches)
    .where(eq(computerImportBatches.shopId, shop.id));
  const dives = await db.select().from(computerDives).where(eq(computerDives.shopId, shop.id));
  const profiles = await db
    .select()
    .from(computerDiveProfiles)
    .where(eq(computerDiveProfiles.shopId, shop.id));
  expect(batches).toHaveLength(1);
  expect(dives).toHaveLength(1);
  expect(profiles).toHaveLength(1);
  const [batch] = batches;
  const [dive] = dives;
  const [profile] = profiles;
  expect(batch).toMatchObject({
    personId: booking.personId,
    requestKey: "demo-recap-computer",
    importedCount: 1,
    skippedCount: 0,
  });
  expect(dive).toMatchObject({
    personId: booking.personId,
    batchId: batch?.id,
    fingerprint: "demo-recap-computer-dive",
    record: { sourceId: "demo-recap-1" },
  });
  expect(profile).toMatchObject({ personId: booking.personId, diveId: dive?.id });
  expect(SAMPLE_PROFILE.length).toBeGreaterThan(1);
  expect(profile?.samples).toEqual(
    SAMPLE_PROFILE.map((sample) => ({
      seconds: sample.seconds,
      depthMeters: sample.meters,
      temperatureC: sample.meters > 12 ? 26 : 28,
    })),
  );

  const input = await loadShopExportBundleInput(db, shop.id);
  if (!input || !batch || !dive || !profile) throw new Error("seeded computer export missing");
  const batchFile = table(input, "computer_import_batches.csv");
  const diveFile = table(input, "computer_dives.csv");
  const profileFile = table(input, "computer_dive_profiles.csv");
  expect(batchFile.rows).toHaveLength(1);
  expect(diveFile.rows).toHaveLength(1);
  expect(profileFile.rows).toHaveLength(1);
  expect(batchFile.rows[0]?.[batchFile.header.indexOf("id")]).toBe(batch.id);
  expect(diveFile.rows[0]?.[diveFile.header.indexOf("batch_id")]).toBe(batch.id);
  expect(profileFile.rows[0]?.[profileFile.header.indexOf("dive_id")]).toBe(dive.id);
  expect(profileFile.rows[0]?.[profileFile.header.indexOf("samples")]).toBe(
    JSON.stringify(profile.samples),
  );
});
