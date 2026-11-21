import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { SAMPLE_PROFILE } from "@/lib/dive-profile-sample";
import { seededShopContext } from "@/test/db";
import { loadShopExportBundleInput } from "../export";
import { table } from "../export/bundle-table.test-support";
import {
  bookings,
  computerDiveProfiles,
  computerDives,
  computerImportBatches,
  executedDives,
  tripConservation,
  tripRecapPhotos,
} from "../schema";
import { DEMO_RECAP_BOOKING_ID } from "./identifiers";

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
  const batch = batches.find((row) => row.requestKey === "demo-recap-computer");
  const dive = dives.find((row) => row.fingerprint === "demo-recap-computer-dive");
  const profile = profiles.find((row) => row.diveId === dive?.id);
  expect(batches.length).toBeGreaterThan(1);
  expect(dives.length).toBeGreaterThan(1);
  expect(profiles.length).toBeGreaterThan(1);
  const photos = await db.select().from(tripRecapPhotos).where(eq(tripRecapPhotos.shopId, shop.id));
  const logs = await db.select().from(executedDives).where(eq(executedDives.shopId, shop.id));
  const conservation = await db
    .select()
    .from(tripConservation)
    .where(eq(tripConservation.shopId, shop.id));
  expect(photos.length).toBeGreaterThanOrEqual(3);
  expect(
    logs.filter((row) => row.observedSpeciesEntries.length >= 3 && row.observedConditions),
  ).toHaveLength(12);
  expect(conservation.length).toBeGreaterThanOrEqual(3);
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
  expect(batchFile.rows.some((row) => row[batchFile.header.indexOf("id")] === batch.id)).toBe(true);
  expect(diveFile.rows.some((row) => row[diveFile.header.indexOf("batch_id")] === batch.id)).toBe(
    true,
  );
  const exportedProfile = profileFile.rows.find(
    (row) => row[profileFile.header.indexOf("dive_id")] === dive.id,
  );
  expect(exportedProfile?.[profileFile.header.indexOf("samples")]).toBe(
    JSON.stringify(profile.samples),
  );
});
