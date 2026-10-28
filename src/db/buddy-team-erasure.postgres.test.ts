import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import {
  addBuddyTeamMember,
  dissolveBuddyTeam,
  formBuddyTeam,
  removeBuddyTeamMember,
} from "./buddy-pairs";
import {
  bookings,
  buddyTeamEvents,
  certifications,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
} from "./schema";

type Operation = "form" | "add" | "remove" | "dissolve";

async function fixture(operation: Operation) {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Trail shop", slug: "trail-shop", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [owner, first, second, third] = await pg.db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Owner" },
      { shopId: shop.id, fullName: "Maya Stone" },
      { shopId: shop.id, fullName: "Second Diver" },
      { shopId: shop.id, fullName: "Third Diver" },
    ])
    .returning();
  if (!owner || !first || !second || !third) throw new Error("people missing");
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
      [first, second, third].map((person) => ({
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        status: "booked" as const,
        bookedAs: "diver" as const,
        participantType: "diver" as const,
      })),
    )
    .returning();
  const members = seats.map((seat) => ({ kind: "diver" as const, bookingId: seat.id }));
  const [card] = await pg.db
    .insert(certifications)
    .values({
      shopId: shop.id,
      personId: first.id,
      agency: "padi",
      level: "open_water",
      identifier: "CARD",
      status: "verified",
    })
    .returning();
  if (!card || !members[0] || !members[2]) throw new Error("fixture missing");
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
  const erase = () =>
    anonymizeDiver(pg.connect(), { shopId: shop.id, personId: first.id, actorPersonId: owner.id });
  const noName = async () => {
    const events = await pg.db
      .select({ names: buddyTeamEvents.memberNames })
      .from(buddyTeamEvents)
      .where(eq(buddyTeamEvents.shopId, shop.id));
    expect(JSON.stringify(events)).not.toContain("Maya Stone");
  };
  return { pg, card, mutate, erase, noName };
}

describePostgres("manual buddy team trail against erasure", () => {
  for (const operation of ["form", "add", "remove", "dissolve"] as const) {
    it(`${operation}: erasure waits for the already-resolved event and scrubs its name`, async () => {
      const { pg, mutate, erase, noName } = await fixture(operation);
      await pg.db.execute(
        sql`create function test_hold_buddy_event() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(281033); return new; end $$`,
      );
      await pg.db.execute(
        sql`create trigger test_hold_buddy_event before insert on buddy_team_events for each row execute function test_hold_buddy_event()`,
      );
      const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(281033)`);
      const mutation = mutate();
      let erasing: ReturnType<typeof erase> | undefined;
      let erased = false;
      try {
        await waitForLockWaiters(pg.db, 1);
        erasing = erase();
        void erasing.then(() => {
          erased = true;
        });
        try {
          await waitForLockWaiters(pg.db, 2, 1_000);
        } catch (error) {
          if (!erased) throw error;
        }
      } finally {
        await gate.release();
      }
      expect((await mutation).ok).toBe(true);
      expect((await erasing)?.ok).toBe(true);
      await noName();
    });

    it(`${operation}: a writer backs out while erasure owns a member`, async () => {
      const { pg, card, mutate, erase, noName } = await fixture(operation);
      const gate = await holdRowLock(
        pg,
        sql`select id from certifications where id = ${card.id} for update`,
      );
      const erasing = erase();
      try {
        await waitForLockWaiters(pg.db, 1);
        expect(await mutate()).toEqual({ ok: false, reason: "busy" });
      } finally {
        await gate.release();
      }
      expect((await erasing).ok).toBe(true);
      await noName();
    });
  }
});
