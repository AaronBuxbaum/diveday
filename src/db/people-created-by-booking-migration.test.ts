// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * The backfill of `people.created_by_booking_id` (issue #2665, decided by
 * Aaron 2026-10-17): a person who existed before the column is stamped only
 * where their one booking was made in the same moment they were.
 * `createTestDb()` has already applied the migration to an empty database, so
 * the test writes unstamped rows and runs the migration's update over them.
 */
const ctx = fileScopedShopContext();

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const FOLDER = readdirSync(MIGRATIONS).find((name) => name.endsWith("_people-created-by-booking"));

async function runBackfill() {
  if (!FOLDER) throw new Error("the people-created-by-booking migration is missing");
  const text = readFileSync(path.join(MIGRATIONS, FOLDER, "migration.sql"), "utf8");
  // The first statement adds the column, which the test database already has.
  const [, ...updates] = text.split("--> statement-breakpoint");
  for (const statement of updates) {
    if (statement.trim()) await ctx.db.execute(sql.raw(statement));
  }
}

async function trips() {
  const rows = await upcomingTripsWithCounts(ctx.db, ctx.shop.id);
  const [first, second] = rows;
  if (!first || !second) throw new Error("expected two seeded trips");
  return [first, second] as const;
}

const madeAt = new Date("2026-09-01T12:00:00.000Z");
const later = (ms: number) => new Date(madeAt.getTime() + ms);

async function personWithSeats(
  name: string,
  seatsAt: { tripId: string; at: Date }[],
  email: string | null = null,
) {
  const [person] = await ctx.db
    .insert(people)
    .values({ shopId: ctx.shop.id, fullName: name, email, createdAt: madeAt })
    .returning();
  if (!person) throw new Error("person insert failed");
  const seats = [];
  for (const seat of seatsAt) {
    const [row] = await ctx.db
      .insert(bookings)
      .values({
        shopId: ctx.shop.id,
        tripId: seat.tripId,
        personId: person.id,
        bookedAs: "diver",
        createdAt: seat.at,
      })
      .returning();
    if (!row) throw new Error("booking insert failed");
    seats.push(row);
  }
  return { person, seats };
}

async function stampOf(personId: string) {
  const [row] = await ctx.db
    .select({ stamp: people.createdByBookingId })
    .from(people)
    .where(eq(people.id, personId));
  return row?.stamp ?? null;
}

describe("the created_by_booking_id backfill", () => {
  it("stamps a person whose one booking was made in the same moment", async () => {
    const [trip] = await trips();
    const { person, seats } = await personWithSeats("Same Moment", [
      { tripId: trip.id, at: later(40) },
    ]);
    await runBackfill();
    expect(await stampOf(person.id)).toBe(seats[0]?.id);
  });

  it("leaves a person whose one booking came later, or earlier, unstamped", async () => {
    const [trip, other] = await trips();
    const late = await personWithSeats("Booked Later", [{ tripId: trip.id, at: later(60_000) }]);
    const early = await personWithSeats("Booked Before", [{ tripId: other.id, at: later(-1) }]);
    await runBackfill();
    expect(await stampOf(late.person.id)).toBeNull();
    expect(await stampOf(early.person.id)).toBeNull();
  });

  it("leaves a person with a second booking, or none, unstamped", async () => {
    const [trip, other] = await trips();
    const twice = await personWithSeats("Two Seats", [
      { tripId: trip.id, at: later(40) },
      { tripId: other.id, at: later(90_000) },
    ]);
    const none = await personWithSeats("Imported Contact", []);
    await runBackfill();
    expect(await stampOf(twice.person.id)).toBeNull();
    expect(await stampOf(none.person.id)).toBeNull();
  });

  it("leaves a person with an email unstamped: a lead or a returning diver, never a name-only seat", async () => {
    const [trip] = await trips();
    const lead = await personWithSeats(
      "Lead With Email",
      [{ tripId: trip.id, at: later(40) }],
      "lead-2665@example.com",
    );
    await runBackfill();
    expect(await stampOf(lead.person.id)).toBeNull();
  });
});
