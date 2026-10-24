import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate, nowMs } from "@/lib/clock";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { listTripReadiness } from "./readiness";
import { trips, waiverRecords } from "./schema";
import { at, DEMO_SHOP_TIMEZONE, withinDeskHours } from "./seed-clock";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";
import { seedWaiverEvidence, signedBeforeDeparture } from "./seed-waiver-evidence";
import { liveTrip } from "./trips";
import { listWaiverIntegrityAudit } from "./waivers";

/**
 * The shop's signed evidence, as the Signatures tab reads it
 * (src/db/seed-waiver-evidence.ts). Two invariants, and both of them are the
 * point of the scenario rather than a count: a sealed record must actually
 * *verify* (a seal computed over the wrong snapshot reads `invalid`, which is
 * the one thing a demo of an integrity check must never show), and signatures
 * must be spread over the days divers really signed on rather than piled onto
 * this instant.
 */
async function evidence() {
  const { db, shop } = await seededShopContext({ history: true });
  const records = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shop.id),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
      ),
    );
  return { db, shop, records };
}

describe("seeded waiver evidence", () => {
  it("holds both integrity states, and every sealed record verifies", async () => {
    const { records } = await evidence();
    const states = records.map(verifyWaiverIntegrity);
    expect(states.filter((state) => state === "valid").length).toBeGreaterThan(0);
    expect(states.filter((state) => state === "unsealed").length).toBeGreaterThan(0);
    // Never `invalid`. A seed that sealed a record and then changed a field
    // inside the seal would land here, and it would teach a reader that the
    // shop's own untampered evidence had been tampered with.
    expect(states.filter((state) => state === "invalid")).toEqual([]);
  });

  it("shows both states on the audit trail's first page, without paging", async () => {
    const { db, shop } = await evidence();
    const page = await listWaiverIntegrityAudit(db, shop.id);
    const states = new Set(page.entries.map((entry) => entry.integrity));
    expect(states).toEqual(new Set(["valid", "unsealed"]));
  });

  it("spreads signatures across previous days instead of one instant", async () => {
    const { records } = await evidence();
    const signed = records
      .map((record) => record.signedAt)
      .filter((value): value is Date => value !== null);
    expect(signed.length).toBeGreaterThan(0);

    // No signature is in the future — a release signed after "now" is the
    // giveaway that a seeded date was pinned to a wall hour rather than
    // measured back from the clock.
    const now = nowMs();
    expect(signed.filter((value) => value.getTime() > now)).toEqual([]);

    // The recent evidence, which is what the audit trail's first pages show,
    // lands on many distinct days rather than all on today.
    const recent = signed.filter((value) => value.getTime() > now - 21 * DAY_MS);
    const days = new Set(recent.map((value) => value.toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(14);
    const today = new Date(now).toISOString().slice(0, 10);
    expect(
      recent.filter((value) => value.toISOString().slice(0, 10) === today).length,
    ).toBeLessThan(recent.length / 2);
  });

  it("keeps a signed release self-consistent after re-dating", async () => {
    const { records } = await evidence();
    for (const record of records) {
      if (!record.signedAt) continue;
      // Consent, signature and completion are one sitting; the record is
      // created no later than the signature it carries.
      expect(record.consentedAt?.getTime()).toBe(record.signedAt.getTime());
      const lag = (record.completedAt?.getTime() ?? Number.NaN) - record.signedAt.getTime();
      expect(lag).toBeGreaterThanOrEqual(0);
      expect(lag).toBeLessThanOrEqual(10 * 60_000);
      expect(record.createdAt.getTime()).toBeLessThanOrEqual(record.signedAt.getTime());
    }
  });
});

describe("withinDeskHours", () => {
  const zone = "America/New_York";

  it("keeps a signature the desk took while open", () => {
    const tenAm = new Date("2026-10-13T14:00:00.000Z");
    expect(withinDeskHours(tenAm, zone)).toEqual(tenAm);
  });

  it("moves a late-evening signature back to the last open hour that day", () => {
    // 11:24 PM EDT on Oct 13, the time the dawn log printed.
    const late = new Date("2026-10-14T03:24:00.007Z");
    expect(withinDeskHours(late, zone).toISOString()).toBe("2026-10-13T21:24:00.007Z");
  });

  it("moves a before-opening signature back to the evening before", () => {
    const early = new Date("2026-10-14T10:05:00.000Z"); // 6:05 AM EDT
    expect(withinDeskHours(early, zone).toISOString()).toBe("2026-10-13T21:05:00.000Z");
  });
});

describe("staff-recorded signatures", () => {
  it("fall in desk hours, not near midnight", async () => {
    const { records } = await evidence();
    const staffRecorded = records.filter(
      (record) => record.signatureMethod === "in_person_attested",
    );
    expect(staffRecorded.length).toBeGreaterThan(0);
    const outside = staffRecorded
      .filter((record) => record.signedAt && record.signedAt.getTime() >= nowMs() - 21 * DAY_MS)
      .map((record) => record.signedAt as Date)
      .filter((signedAt) => {
        const { hour } = utcToWallTime(signedAt, DEMO_SHOP_TIMEZONE);
        return hour < 8 || hour >= 18;
      });
    expect(outside).toEqual([]);
  });
});

describe("seeded signature methods", () => {
  it("are only methods the product writes, and a paper release names who took it", async () => {
    const { records } = await evidence();
    const known = new Set([
      "typed_consent",
      "in_person_attested",
      "imported",
      "in_person_attested_namesake",
    ]);
    expect(records.filter((record) => !known.has(record.signatureMethod ?? ""))).toEqual([]);
    const paper = records.filter((record) => record.signatureMethod === "in_person_attested");
    expect(paper.length).toBeGreaterThan(0);
    expect(paper.filter((record) => record.recordedByPersonId === null)).toEqual([]);
    // The diver's own full name, never a constant, and a record never completes
    // before it was signed.
    expect(paper.filter((record) => record.signedName === "Signed on file")).toEqual([]);
    expect(
      paper.filter(
        (record) => record.completedAt && record.signedAt && record.completedAt < record.signedAt,
      ),
    ).toEqual([]);
  });
});

describe("a release on a departure", () => {
  // Today's boats that have already left: the seed's re-dating moves releases
  // stamped at its own "now", so these are the departures it can push a
  // signature past. Older departures sign on the day they sailed
  // (seed-history), before this pass ever runs.
  it("is never signed after that departure left (issue #2698)", async () => {
    const { db, shop } = await evidence();
    const departed = await db
      .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          liveTrip(),
          gte(trips.startsAt, at(0, 0)),
          lte(trips.startsAt, nowDate()),
        ),
      );
    expect(departed.length).toBeGreaterThan(0);
    const late: string[] = [];
    for (const trip of departed) {
      // The governing release as the departure log reads it: as of the boat's
      // own departure, not as of the printing.
      const rows = await listTripReadiness(db, shop.id, trip.id, trip.startsAt);
      for (const row of rows) {
        const signedAt = row.waiver?.signedAt;
        if (signedAt && signedAt.getTime() > trip.startsAt.getTime()) {
          late.push(
            `${trip.title} ${trip.startsAt.toISOString()}: signed ${signedAt.toISOString()}`,
          );
        }
      }
    }
    expect(late).toEqual([]);
  });

  // The demo dawn boat's log read "signed in person at 12:58 PM" beside a
  // 5:30 AM boarding: a release stamped at the seed's "now" was moved to
  // about now, minus minutes, with no regard for the boat it covered. Stamp a
  // dawn diver's release at "now" again, first in line for the spread, and
  // replay the pass: the spread's first slot is minutes before the frozen
  // 9:30 AM clock, hours after the dawn boat sailed.
  it("moves a release stamped now to before the diver's own boat", async () => {
    const { db, shop } = await evidence();
    const [dawn] = await db
      .select({ id: trips.id, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE)));
    if (!dawn) throw new Error("the demo has no dawn boat");
    const before = await listTripReadiness(db, shop.id, dawn.id, dawn.startsAt);
    const record = before.find((row) => row.waiver?.signedAt)?.waiver;
    if (!record) throw new Error("no dawn diver has a release");
    const now = nowDate();
    await db
      .update(waiverRecords)
      .set({
        signedAt: now,
        consentedAt: now,
        completedAt: now,
        createdAt: at(-30, 0),
        integrityHash: null,
        integrityVersion: null,
      })
      .where(eq(waiverRecords.id, record.id));

    await seedWaiverEvidence(db, shop.id);

    const [replayed] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
    expect(replayed?.signedAt?.getTime()).toBeLessThan(dawn.startsAt.getTime());
    expect(replayed && verifyWaiverIntegrity(replayed)).not.toBe("invalid");
  });
});

/**
 * The clamp on its own, away from the frozen 9:30 AM clock (domain review 3B):
 * a boat just after midnight, and dawn boats on the two days New York changes
 * its clocks, when "the evening before" is 23 or 25 hours back.
 */
describe("signedBeforeDeparture", () => {
  const local = (year: number, month: number, day: number, hour: number, minute = 0) =>
    wallTimeToUtc({ year, month, day, hour, minute }, DEMO_SHOP_TIMEZONE);
  const expectBeforeAndInDeskHours = (signed: Date, departs: Date) => {
    expect(signed.getTime()).toBeLessThan(departs.getTime());
    const wall = utcToWallTime(signed, DEMO_SHOP_TIMEZONE);
    expect(wall.hour).toBeGreaterThanOrEqual(8);
    expect(wall.hour).toBeLessThan(18);
    return wall;
  };

  it("puts a release for a boat just after midnight on the evening before", () => {
    const departs = local(2026, 10, 25, 0, 20);
    const signed = signedBeforeDeparture(local(2026, 10, 25, 9, 0), departs, 7);
    const wall = expectBeforeAndInDeskHours(signed, departs);
    expect([wall.month, wall.day]).toEqual([10, 24]);
  });

  it("puts a dawn boat's release on the evening before across both clock changes", () => {
    for (const [month, day] of [
      [3, 8],
      [11, 1],
    ] as const) {
      const departs = local(2026, month, day, 6, 0);
      const signed = signedBeforeDeparture(local(2026, month, day, 9, 0), departs, 3);
      const wall = expectBeforeAndInDeskHours(signed, departs);
      expect([wall.month, wall.day]).toEqual([month === 3 ? 3 : 10, month === 3 ? 7 : 31]);
    }
  });
});
