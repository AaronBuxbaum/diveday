import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { startIncidentReport, startMissingDiverReport } from "./incident-reports";
import {
  incidentReports,
  people,
  personRoles,
  rollCallCrewEvents,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";

/**
 * **One draft per writer per departure, under genuine contention** (safety
 * sheet 2026-10-15, item 3). PGlite is one connection, so two "concurrent"
 * starts there share a session and its re-entrant advisory lock: the guard is
 * only exercised here.
 *
 * The starting gate is a `FOR UPDATE` on the departure's row. Each contender's
 * INSERT carries a foreign key to `trips`, whose check takes `KEY SHARE` on that
 * row, so without the guard both contenders read "no draft", both insert, and
 * both park on the gate: released, two drafts. With the guard the first parks
 * on the gate holding the advisory lock and the second parks on the lock; once
 * the gate drops, the second reads the first's committed draft. The assertion
 * that catches a broken guard is the draft count, never the wait.
 */

const HOUR_MS = 60 * 60 * 1000;

async function departureWithCrew(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({ name: `Incident Race ${suffix}`, slug: `incident-race-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const startsAt = new Date(nowDate().getTime() - HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 12,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const [crew] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Sal Rivera" })
    .returning({ id: people.id });
  if (!crew) throw new Error("person insert returned no row");
  await db.insert(personRoles).values({ personId: crew.id, role: "divemaster" });
  await db.insert(userAccounts).values({ personId: crew.id, email: `sal-${suffix}@example.com` });
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: crew.id });
  return { shopId: shop.id, tripId: trip.id, crewId: crew.id, suffix };
}

/** A second crew member on the departure, and a third marked not back aboard. */
async function twoMoreCrew(
  db: AppDb,
  at: { shopId: string; tripId: string; crewId: string; suffix: string },
) {
  const ids: string[] = [];
  for (const name of ["Ana Ortiz", "Dev Patel"]) {
    const [person] = await db
      .insert(people)
      .values({ shopId: at.shopId, fullName: name })
      .returning({ id: people.id });
    if (!person) throw new Error("person insert returned no row");
    await db.insert(personRoles).values({ personId: person.id, role: "divemaster" });
    await db.insert(userAccounts).values({
      personId: person.id,
      email: `${name.split(" ")[0]?.toLowerCase()}-${at.suffix}@example.com`,
    });
    await db.insert(tripAssignments).values({ tripId: at.tripId, personId: person.id });
    ids.push(person.id);
  }
  const [second, missing] = ids as [string, string];
  await db.insert(rollCallCrewEvents).values({
    shopId: at.shopId,
    tripId: at.tripId,
    personId: missing,
    recordedByPersonId: at.crewId,
    status: "not_boarded",
    checkpoint: "after_dive_1",
    occurredAt: nowDate(),
  });
  return { secondId: second, missingId: missing };
}

describePostgres("startIncidentReport under real concurrency", () => {
  it("gives two simultaneous taps by one writer the same single draft", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, crewId } = await departureWithCrew(pg.db);

    const gate = await holdRowLock(pg, sql`select id from trips where id = ${tripId} for update`);
    const input = { shopId, tripId, actorPersonId: crewId };
    const contenders = [
      startIncidentReport(pg.connect(), input),
      startIncidentReport(pg.connect(), input),
    ];
    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    const ids = outcomes.map((outcome) => (outcome.ok ? outcome.reportId : null));
    expect(ids[0]).not.toBeNull();
    expect(ids[1]).toBe(ids[0]);
    const drafts = await pg.db
      .select({ id: incidentReports.id })
      .from(incidentReports)
      .where(and(eq(incidentReports.tripId, tripId), eq(incidentReports.status, "draft")));
    expect(drafts).toHaveLength(1);
  });

  it("gives two crew tapping for one missing person at once a single report", async () => {
    const pg = await postgresTestDb();
    const at = await departureWithCrew(pg.db);
    const { secondId, missingId } = await twoMoreCrew(pg.db, at);

    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${at.tripId} for update`,
    );
    const subject = { kind: "crew" as const, personId: missingId };
    const base = { shopId: at.shopId, tripId: at.tripId, subject };
    const contenders = [
      startMissingDiverReport(pg.connect(), { ...base, actorPersonId: at.crewId }),
      startMissingDiverReport(pg.connect(), { ...base, actorPersonId: secondId }),
    ];
    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    // One of them started it; the other was told who did.
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => !outcome.ok && outcome.reason === "already_started"),
    ).toHaveLength(1);
    const reports = await pg.db
      .select({ id: incidentReports.id })
      .from(incidentReports)
      .where(eq(incidentReports.tripId, at.tripId));
    expect(reports).toHaveLength(1);
  });
});
