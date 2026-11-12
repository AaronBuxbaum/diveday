import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { assembleEveningClose } from "@/features/today/closeout";
import { getDayCloseout } from "@/features/today/closeout-reader";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { recordCrewRollCall, recordRollCall } from "./manifests";
import { personRoles, tripAssignments } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, setTripCrew, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

describePostgres("dual-role homecoming physical totals", () => {
  it("counts each person once per departure and keeps a conflicting missing alarm", async () => {
    const { db } = await postgresTestDb();
    const version = await db.execute(sql`select version() as version`);
    expect(version.rows[0]?.version).toContain("PostgreSQL");
    await seedDemo(db, "lean");
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("seeded shop missing");
    const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("seeded departure missing");
    const roster = await getTripRoster(db, shop.id, reef.id);
    const booking = roster[0];
    if (!booking) throw new Error("seeded booking missing");
    const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await db.insert(personRoles).values({ personId: booking.person.id, role: "divemaster" });
    const existingCrew = await db
      .select()
      .from(tripAssignments)
      .where(eq(tripAssignments.tripId, reef.id));
    expect(
      await setTripCrew(db, shop.id, reef.id, [
        ...existingCrew.map((row) => row.personId),
        booking.person.id,
      ]),
    ).toBe(true);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.booking.id });
    if (!issued.ok) throw new Error("waiver issue failed");
    expect(
      await completeWaiver(db, issued.key, {
        signerName: booking.person.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      }),
    ).toMatchObject({ ok: true });
    for (const checkpoint of ["departure", "after_dive_1", "after_dive_2"] as const) {
      const input = {
        shopId: shop.id,
        tripId: reef.id,
        recordedByPersonId: actor,
        status: "boarded" as const,
        checkpoint,
      };
      expect(await recordRollCall(db, { ...input, bookingId: booking.booking.id })).toMatchObject({
        ok: true,
      });
      expect(await recordCrewRollCall(db, { ...input, personId: booking.person.id })).toMatchObject(
        { ok: true },
      );
    }
    const at = new Date(reef.endsAt.getTime() + 2 * 60 * 60 * 1000);
    const read = async () =>
      assembleEveningClose((await getDayCloseout(db, shop.id, shop.timezone, at)).departures, at);
    const before = await read();
    expect(before.out).toBe(before.divers + before.crew - 1);
    const own = before.stations.find((station) => station.tripId === reef.id);
    expect(own?.physicalOverlap).toEqual({ out: 1, back: 1 });
    expect(before.back).toBe(
      before.stations.reduce((n, station) => n + station.back + station.crewBack, 0) - 1,
    );
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        recordedByPersonId: actor,
        bookingId: booking.booking.id,
        status: "not_boarded",
        checkpoint: "after_dive_2",
      }),
    ).toMatchObject({ ok: true });
    const conflict = await read();
    expect(conflict.allHome).toBe(false);
    expect(conflict.stations.find((station) => station.tripId === reef.id)).toMatchObject({
      gapReason: "missing_diver",
      physicalOverlap: { out: 1, back: 0 },
    });
  });
});
