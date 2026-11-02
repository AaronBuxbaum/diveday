import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tripAssignments, trips as tripRows } from "@/db/schema";
import {
  DEMO_MEDICAL_ALERT,
  DEMO_MEDICAL_ALERT_DIVER,
  DEMO_MEDICAL_ALERT_TRIP,
} from "@/db/seed-medical-alert";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import { readManifestPage } from "./manifest-reads";

const ctx = fileScopedShopContext();

describe("readManifestPage (in-memory PGlite)", () => {
  it("reads one departure's manifests and the departure's own rows, in one call", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");

    const reads = await readManifestPage(db, shop.id, reef.id, staff.person.id);

    // One manifest per checkpoint: the dock, then one after each planned dive.
    expect(reads.completeManifests?.map((entry) => entry.checkpoint)).toEqual([
      "departure",
      ...Array.from({ length: reef.plannedDives }, (_, index) => `after_dive_${index + 1}`),
    ]);
    expect(reads.completeManifests?.[0]?.divers.length).toBeGreaterThan(0);
    expect(reads.plannedDives.length).toBe(reef.plannedDives);
    // Never worked this departure: there is nothing for a catch-up to be "since".
    expect(reads.catchUp.mark).toBeNull();
    // The field guides are keyed by the live sites the first wave returned.
    for (const siteId of reads.fieldGuides.keys()) {
      expect(reads.liveDiveSites.map((site) => site.id)).toContain(siteId);
    }
  });

  it("reads nothing for a departure that is not this shop's", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const reads = await readManifestPage(
      db,
      shop.id,
      "00000000-0000-4000-8000-000000000000",
      staff?.person.id ?? "",
    );
    expect(reads.completeManifests?.[0]).toBeUndefined();
  });

  it("carries no diver's medical alert words, even for the owner (H-20261023-medical-alert-for-the: only a recorded tap or an explicit offline save)", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const departure = trips.find((trip) => trip.title === DEMO_MEDICAL_ALERT_TRIP);
    if (!departure) throw new Error("seeded alert departure missing");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);

    const reads = await readManifestPage(db, shop.id, departure.id, owner);

    // The fact rides, so the chip shows and the reveal is offered.
    expect(reads.reader.mayReadMedicalAlerts).toBe(true);
    const flagged = reads.completeManifests?.[0]?.divers.filter((diver) => diver.medicalAlert);
    expect(flagged?.map((diver) => diver.fullName)).toEqual([DEMO_MEDICAL_ALERT_DIVER]);
    // The words do not: not in anything the page renders, serializes or
    // builds its offline payload from.
    const everything = JSON.stringify(reads, (_key, value) =>
      value instanceof Map || value instanceof Set ? [...value] : value,
    );
    expect(everything).not.toContain(DEMO_MEDICAL_ALERT);
    expect(everything).not.toContain("EpiPen");
  });

  it("offers the emergency read off the crew from the day before until the trip's days end (domain review 2, S1)", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const departure = trips.find((trip) => trip.title === DEMO_MEDICAL_ALERT_TRIP);
    if (!departure) throw new Error("seeded alert departure missing");
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    await db
      .delete(tripAssignments)
      .where(and(eq(tripAssignments.tripId, departure.id), eq(tripAssignments.personId, captain)));
    const DAY_MS = 24 * 60 * 60 * 1000;
    const leaving = async (offset: number) => {
      const startsAt = new Date(nowDate().getTime() + offset);
      await db
        .update(tripRows)
        .set({ startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) })
        .where(eq(tripRows.id, departure.id));
      return (await readManifestPage(db, shop.id, departure.id, captain)).reader;
    };
    // A tab opened the night before keeps the offer; the server decides on the confirm.
    expect(await leaving(DAY_MS)).toMatchObject({
      mayReadMedicalAlerts: false,
      mayEmergencyReadMedicalAlerts: true,
    });
    expect((await leaving(0)).mayEmergencyReadMedicalAlerts).toBe(true);
    // Over: the owner or a manager reads it any time.
    expect((await leaving(-DAY_MS)).mayEmergencyReadMedicalAlerts).toBe(false);
    // Never to someone the crew rule already admits.
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await leaving(0);
    expect((await readManifestPage(db, shop.id, departure.id, owner)).reader).toMatchObject({
      mayReadMedicalAlerts: true,
      mayEmergencyReadMedicalAlerts: false,
    });
  });
});
