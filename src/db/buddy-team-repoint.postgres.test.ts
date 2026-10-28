import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  addBuddyTeamMember,
  dissolveBuddyTeam,
  formBuddyTeam,
  removeBuddyTeamMember,
} from "./buddy-pairs";
import { repointHeldBooking } from "./identity-repoint";
import { bookings, people, personRoles, shops, trips, userAccounts } from "./schema";

type Operation = "form" | "add" | "remove" | "dissolve";
async function fixture(operation: Operation) {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Repoint shop", slug: "repoint-race", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [owner, first, namesake, second, third] = await pg.db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Owner" },
      { shopId: shop.id, fullName: "Alex Kim" },
      { shopId: shop.id, fullName: "Alex Kim" },
      { shopId: shop.id, fullName: "Other Diver" },
      { shopId: shop.id, fullName: "Third Diver" },
    ])
    .returning();
  if (!owner || !first || !namesake || !second || !third) throw new Error("people missing");
  await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
  await pg.db
    .insert(userAccounts)
    .values({ personId: owner.id, email: "owner@example.com", hashedPassword: "unused" });
  const [trip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Reef trip",
      startsAt: new Date("2031-05-12T13:00:00Z"),
      endsAt: new Date("2031-05-12T17:00:00Z"),
      capacity: 6,
    })
    .returning();
  if (!trip) throw new Error("trip missing");
  const seats = await pg.db
    .insert(bookings)
    .values(
      [first, second, third].map((person, index) => ({
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        status: "booked" as const,
        bookedAs: "diver" as const,
        participantType: "diver" as const,
        ...(index === 0
          ? {
              identityUnconfirmedAt: nowDate(),
              identityBookedAs: "Alex Kim",
              identityMatchedBy: "picked_name" as const,
            }
          : {}),
      })),
    )
    .returning();
  const members = seats.map((seat) => ({ kind: "diver" as const, bookingId: seat.id }));
  if (!members[0] || !members[2]) throw new Error("seats missing");
  const common = { shopId: shop.id, tripId: trip.id, recordedByPersonId: owner.id };
  const formed =
    operation === "form"
      ? null
      : await formBuddyTeam(pg.connect(), {
          ...common,
          members: operation === "add" ? members.slice(0, 2) : members,
        });
  if (formed && !formed.ok) throw new Error(`initial team refused: ${formed.reason}`);
  const teamId = formed?.ok ? formed.teamId : "";
  const mutate = () =>
    operation === "form"
      ? formBuddyTeam(pg.connect(), { ...common, members: members.slice(0, 2) })
      : operation === "add"
        ? addBuddyTeamMember(pg.connect(), { ...common, teamId, member: members[2] })
        : operation === "remove"
          ? removeBuddyTeamMember(pg.connect(), { ...common, teamId, member: members[0] })
          : dissolveBuddyTeam(pg.connect(), { ...common, teamId });
  const repoint = () =>
    repointHeldBooking(pg.connect(), {
      shopId: shop.id,
      bookingId: members[0].bookingId,
      toPersonId: namesake.id,
      actorPersonId: owner.id,
    });
  const verifyHeld = async () => {
    const [after] = await pg.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, members[0].bookingId));
    expect(after?.personId).toBe(namesake.id);
    expect(after?.identityUnconfirmedAt).not.toBeNull();
  };
  return { pg, first, mutate, repoint, verifyHeld };
}

describePostgres("manual team changes against held-seat repointing", () => {
  for (const operation of ["form", "add", "remove", "dissolve"] as const) {
    it(`${operation}: a repoint waits when the team writer has locked the seat`, async () => {
      const { pg, mutate, repoint, verifyHeld } = await fixture(operation);
      const table =
        operation === "form" || operation === "add" ? "buddy_pair_members" : "buddy_team_events";
      await pg.db.execute(
        sql`create function test_hold_team_write() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(281034); return new; end $$`,
      );
      await pg.db.execute(
        sql.raw(
          `create trigger test_hold_team_write before insert on ${table} for each row execute function test_hold_team_write()`,
        ),
      );
      const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(281034)`);
      const mutation = Promise.allSettled([mutate()]);
      let moving: ReturnType<typeof repoint> | undefined;
      try {
        await waitForLockWaiters(pg.db, 1);
        moving = repoint();
        await waitForLockWaiters(pg.db, 2);
      } finally {
        await gate.release();
      }
      expect((await mutation)[0]).toMatchObject({ status: "fulfilled", value: { ok: true } });
      expect((await moving)?.ok).toBe(true);
      await verifyHeld();
    });

    it(`${operation}: team mutation backs out when the repoint owns the seat`, async () => {
      const { pg, first, mutate, repoint, verifyHeld } = await fixture(operation);
      const gate = await holdRowLock(
        pg,
        sql`select id from people where id = ${first.id} for no key update`,
      );
      const moving = repoint();
      try {
        await waitForLockWaiters(pg.db, 1);
        expect(await mutate()).toEqual({ ok: false, reason: "busy" });
      } finally {
        await gate.release();
      }
      expect((await moving).ok).toBe(true);
      await verifyHeld();
    });
  }
});
