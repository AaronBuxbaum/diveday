import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { seededShopContext } from "@/test/db";
import { canPersonReadMedicalAlertOnTrip } from "./authz";
import { getTripManifests } from "./manifests";
import { medicalAlertTextsForTrip } from "./medical-alerts";
import { listTripReadiness } from "./readiness";
import { tripAssignments, trips, waiverRecords } from "./schema";
import {
  DEMO_MEDICAL_ALERT,
  DEMO_MEDICAL_ALERT_DIVER,
  DEMO_MEDICAL_ALERT_TRIP,
} from "./seed-medical-alert";

describe("the seeded medical alert", () => {
  it("is one sealed online release, standing for a diver on a crewed upcoming departure", async () => {
    const { db, shop } = await seededShopContext();
    const alerted = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), isNotNull(waiverRecords.medicalAlert)));
    expect(alerted).toHaveLength(1);
    const [record] = alerted;
    if (!record) throw new Error("seeded alert missing");
    expect(record.medicalAlert).toBe(DEMO_MEDICAL_ALERT);
    expect(record.signatureMethod).toBe("typed_consent");
    expect(verifyWaiverIntegrity(record)).toBe("valid");

    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, DEMO_MEDICAL_ALERT_TRIP)));
    if (!trip) throw new Error("seeded departure missing");
    const crew = await db.select().from(tripAssignments).where(eq(tripAssignments.tripId, trip.id));
    expect(crew.length).toBeGreaterThan(0);
    // Assigned by someone else, so the crew reads the words (H-20261023-medical-alert-for-the).
    const readers: boolean[] = [];
    for (const member of crew) {
      expect(member.assignedByPersonId).not.toBeNull();
      expect(member.assignedByPersonId).not.toBe(member.personId);
      readers.push(await canPersonReadMedicalAlertOnTrip(db, shop.id, member.personId, trip.id));
    }
    expect(readers).toContain(true);

    const rows = await listTripReadiness(db, shop.id, trip.id);
    const seat = rows.find((row) => row.person.fullName === DEMO_MEDICAL_ALERT_DIVER);
    expect(seat?.waiver?.id).toBe(record.id);
    // Never a gate: she is as ready as she was.
    expect(seat?.readiness.status).toBe("ready");

    const texts = await medicalAlertTextsForTrip(db, shop.id, trip.id);
    expect([...texts.values()]).toEqual([DEMO_MEDICAL_ALERT]);
    const manifests = await getTripManifests(db, shop.id, trip.id);
    const flagged = manifests?.[0]?.divers.filter((diver) => diver.medicalAlert) ?? [];
    expect(flagged.map((diver) => diver.fullName)).toEqual([DEMO_MEDICAL_ALERT_DIVER]);
  });
});
