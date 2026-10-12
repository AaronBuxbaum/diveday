import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { CREW_NOTICE_SETTLE_MS } from "@/lib/crew-notices";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import {
  countPendingCrewNotices,
  flushUrgentCrewNotices,
  previewCrewNotices,
  sendDueCrewNotices,
} from "./crew-notices";
import { decideCrewAssignmentRequest, requestCrewAssignment } from "./crew-requests";
import { crewNotices, people, shops, trips, userAccounts } from "./schema";
import { createTrip, updateTrip } from "./trips";
import { changeTripCrew, listStaff, setTripCrew } from "./trips-crew";
import { moveTrip } from "./trips-schedule";

/**
 * **Crew hear about their boats** (ADR 20261009-crew-hear-about-their-boats):
 * the write path records each real change, the hourly pass nets what settled
 * and sends one message per person — and never to the person who made it.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";
const DAY_MS = 24 * 60 * 60 * 1_000;

function recorder() {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  return { sent, provider };
}

async function context() {
  const { db, shop } = ctx;
  // The seeded shop is a demo, which settles without sending; these tests are
  // about a real shop's crew. Rolled back with the rest of the test.
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((row) => row.roles.includes("owner"))?.person;
  const crew = staff.find(
    (row) => !row.roles.includes("owner") && !row.roles.includes("manager"),
  )?.person;
  if (!owner || !crew) throw new Error("demo staff missing an owner or a crew member");
  // An address the assertions can pick out, on the person and on any login.
  const email = `crew-${randomUUID()}@diveday.example`;
  await db.update(people).set({ email }).where(eq(people.id, crew.id));
  await db.update(userAccounts).set({ email }).where(eq(userAccounts.personId, crew.id));
  return { db, shop, owner, crew };
}

/** A departure of this shop, `days` out, with nobody on it. */
async function departure(days: number, title = `Boat ${randomUUID().slice(0, 6)}`) {
  const { db, shop } = ctx;
  // Far past the seeded schedule, so no seeded crew clash refuses the change.
  const startsAt = new Date(nowDate().getTime() + (400 + days) * DAY_MS);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title,
    capacity: 10,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000),
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

const settled = () => new Date(nowDate().getTime() + CREW_NOTICE_SETTLE_MS);

describe("the write path", () => {
  it("records a notice for the person put on a boat, and none for the staffer who did it", async () => {
    const { db, shop, owner, crew } = await context();
    const trip = await departure(3);
    const before = await countPendingCrewNotices(db, shop.id, owner.id);
    expect(
      await changeTripCrew(
        db,
        shop.id,
        trip.id,
        { operation: "assign", personId: crew.id },
        { actorPersonId: owner.id },
      ),
    ).toBe(true);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(1);
    expect(await countPendingCrewNotices(db, shop.id, owner.id)).toBe(before);
  });

  it("tells nobody when a staffer puts themselves on a boat", async () => {
    const { db, shop, crew } = await context();
    const trip = await departure(3);
    await changeTripCrew(
      db,
      shop.id,
      trip.id,
      { operation: "assign", personId: crew.id },
      { actorPersonId: crew.id },
    );
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(0);
  });

  it("records a role change on somebody already aboard, and nothing for the same role again", async () => {
    const { db, shop, owner, crew } = await context();
    const trip = await departure(3);
    const as = { actorPersonId: owner.id };
    await changeTripCrew(db, shop.id, trip.id, { operation: "assign", personId: crew.id }, as);
    const roleChange = {
      operation: "assign" as const,
      personId: crew.id,
      tripRole: "crew" as const,
    };
    await changeTripCrew(db, shop.id, trip.id, roleChange, as);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(2);
    await changeTripCrew(db, shop.id, trip.id, roleChange, as);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(2);
    const rows = await db.select().from(crewNotices).where(eq(crewNotices.personId, crew.id));
    expect(rows.map((row) => row.change)).toContain("role_changed");
  });

  it("records nothing for a change the boat refused", async () => {
    const { db, shop, owner, crew } = await context();
    const first = await departure(3);
    // A second departure in the same hours: the clash guard refuses it.
    const [clashing] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Same hours",
        capacity: 10,
        startsAt: first.startsAt,
        endsAt: first.endsAt,
      })
      .returning();
    const as = { actorPersonId: owner.id };
    await changeTripCrew(db, shop.id, first.id, { operation: "assign", personId: crew.id }, as);
    expect(
      await changeTripCrew(
        db,
        shop.id,
        clashing.id,
        { operation: "assign", personId: crew.id },
        as,
      ),
    ).toBe(false);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(1);
  });

  it("records who came on and who came off a whole-crew edit, never who stayed", async () => {
    const { db, shop, owner, crew } = await context();
    const trip = await departure(3);
    const as = { actorPersonId: owner.id };
    await setTripCrew(db, shop.id, trip.id, [crew.id, owner.id], as);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(1);
    await setTripCrew(db, shop.id, trip.id, [crew.id], as);
    // Stayed: no second notice for the crew member.
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(1);
  });
});

describe("the hourly pass", () => {
  it("waits until the person's crew has been still for the settle window", async () => {
    const { db, shop, owner, crew } = await context();
    const trip = await departure(3);
    await changeTripCrew(
      db,
      shop.id,
      trip.id,
      { operation: "assign", personId: crew.id },
      { actorPersonId: owner.id },
    );
    const { sent, provider } = recorder();
    const early = new Date(nowDate().getTime() + CREW_NOTICE_SETTLE_MS - 1);
    await sendDueCrewNotices(db, { now: early, provider, origin: ORIGIN });
    expect(sent.filter((n) => n.to.startsWith("crew-"))).toEqual([]);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(1);
  });

  it("sends one message for a departure the person was put on, in their language", async () => {
    const { db, shop, owner, crew } = await context();
    await db.update(people).set({ locale: "es-ES" }).where(eq(people.id, crew.id));
    const trip = await departure(3, "Two-Tank Reef");
    await changeTripCrew(
      db,
      shop.id,
      trip.id,
      { operation: "assign", personId: crew.id },
      { actorPersonId: owner.id },
    );
    const { sent, provider } = recorder();
    await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    const mine = sent.filter((n) => n.kind === "crew_schedule_change" && n.to.startsWith("crew-"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: "crew_schedule_change",
      locale: "es-ES",
      changes: [{ change: "assigned", tripTitle: "Two-Tank Reef" }],
    });
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(0);
    // Settled means settled: a second pass sends nothing more.
    await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    expect(sent.filter((n) => n.to.startsWith("crew-"))).toHaveLength(1);
  });

  it("says nothing about an assign undone before it settled", async () => {
    const { db, shop, owner, crew } = await context();
    const trip = await departure(3);
    const as = { actorPersonId: owner.id };
    await changeTripCrew(db, shop.id, trip.id, { operation: "assign", personId: crew.id }, as);
    await changeTripCrew(db, shop.id, trip.id, { operation: "unassign", personId: crew.id }, as);
    const { sent, provider } = recorder();
    const summary = await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    expect(sent.filter((n) => n.to.startsWith("crew-"))).toEqual([]);
    expect(summary.quiet).toBeGreaterThanOrEqual(1);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(0);
  });

  it("batches a repeating departure's crew into one message with every date", async () => {
    const { db, shop, owner, crew } = await context();
    const series = [await departure(3), await departure(10), await departure(17)];
    for (const trip of series) {
      await setTripCrew(db, shop.id, trip.id, [crew.id], { actorPersonId: owner.id });
    }
    const { sent, provider } = recorder();
    await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    const mine = sent.filter((n) => n.kind === "crew_schedule_change" && n.to.startsWith("crew-"));
    expect(mine).toHaveLength(1);
    const changes = mine[0]?.kind === "crew_schedule_change" ? mine[0].changes : [];
    expect(changes.map((change) => change.change)).toEqual(["assigned", "assigned", "assigned"]);
    // In date order, each linked to its staff page.
    expect(changes.map((change) => change.startsAt)).toEqual(series.map((trip) => trip.startsAt));
    expect(changes[0]?.tripUrl).toBe(`${ORIGIN}/shop/${shop.slug}/trips/${series[0]?.id}`);
  });

  it("drops a departure that was cancelled before the news settled", async () => {
    const { db, shop, owner, crew } = await context();
    const trip = await departure(3);
    await changeTripCrew(
      db,
      shop.id,
      trip.id,
      { operation: "assign", personId: crew.id },
      { actorPersonId: owner.id },
    );
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    const { sent, provider } = recorder();
    await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    expect(sent.filter((n) => n.to.startsWith("crew-"))).toEqual([]);
  });

  it("settles a demo shop's notices without sending them", async () => {
    const { db, shop, owner, crew } = await context();
    await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
    const trip = await departure(3);
    await changeTripCrew(
      db,
      shop.id,
      trip.id,
      { operation: "assign", personId: crew.id },
      { actorPersonId: owner.id },
    );
    const { sent, provider } = recorder();
    await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    expect(sent.filter((n) => n.to.startsWith("crew-"))).toEqual([]);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(0);
  });
});

describe("answers to a crew member's own ask", () => {
  async function ask() {
    const c = await context();
    const trip = await departure(5, "Wreck Morning");
    const asked = await requestCrewAssignment(c.db, {
      shopId: c.shop.id,
      tripId: trip.id,
      personId: c.crew.id,
      actorPersonId: c.crew.id,
    });
    if (!asked.ok) throw new Error(`ask refused: ${asked.reason}`);
    return { ...c, trip, requestId: asked.id };
  }

  it("says an approval that put them aboard once, as the approval", async () => {
    const { db, shop, owner, crew, trip, requestId } = await ask();
    const decided = await decideCrewAssignmentRequest(db, {
      shopId: shop.id,
      requestId,
      decision: "approved",
      decidedByPersonId: owner.id,
      canManageRoster: true,
    });
    if (!decided.ok) throw new Error("decision refused");
    await changeTripCrew(
      db,
      shop.id,
      trip.id,
      { operation: "assign", personId: crew.id },
      { actorPersonId: owner.id },
    );
    const preview = await previewCrewNotices(db, {
      shopId: shop.id,
      personId: crew.id,
      origin: ORIGIN,
    });
    expect(preview).toMatchObject({
      kind: "crew_schedule_change",
      changes: [{ change: "request_approved", tripTitle: "Wreck Morning" }],
    });
  });

  it("tells them a declined ask was declined", async () => {
    const { db, shop, owner, requestId } = await ask();
    await decideCrewAssignmentRequest(db, {
      shopId: shop.id,
      requestId,
      decision: "declined",
      decidedByPersonId: owner.id,
      canManageRoster: true,
    });
    const { sent, provider } = recorder();
    await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    const mine = sent.filter((n) => n.kind === "crew_schedule_change" && n.to.startsWith("crew-"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ changes: [{ change: "request_declined" }] });
  });

  it("never records a second answer to an ask already answered", async () => {
    const { db, shop, owner, crew, requestId } = await ask();
    const decide = () =>
      decideCrewAssignmentRequest(db, {
        shopId: shop.id,
        requestId,
        decision: "declined",
        decidedByPersonId: owner.id,
        canManageRoster: true,
      });
    await decide();
    await decide();
    const rows = await db.select().from(crewNotices).where(eq(crewNotices.personId, crew.id));
    expect(rows.filter((row) => row.change === "request_declined")).toHaveLength(1);
  });
});

describe("a departure that moves (#2283)", () => {
  const HOUR_MS = 60 * 60 * 1_000;

  async function crewed(days: number) {
    const c = await context();
    const trip = await departure(days, "Night Dive");
    await setTripCrew(c.db, c.shop.id, trip.id, [c.crew.id, c.owner.id], {
      actorPersonId: c.owner.id,
    });
    // The assignment's own news settles first, so what follows is the move alone.
    await sendDueCrewNotices(c.db, {
      now: settled(),
      provider: recorder().provider,
      origin: ORIGIN,
    });
    return { ...c, trip };
  }

  it("tells the crew the time it left before and the time it leaves now, never the mover", async () => {
    const { db, shop, owner, crew, trip } = await crewed(3);
    const later = new Date(trip.startsAt.getTime() + 2 * HOUR_MS);
    const ownerBefore = await countPendingCrewNotices(db, shop.id, owner.id);
    expect((await moveTrip(db, shop.id, trip.id, later, { actorPersonId: owner.id })).ok).toBe(
      true,
    );
    expect(await countPendingCrewNotices(db, shop.id, owner.id)).toBe(ownerBefore);
    const preview = await previewCrewNotices(db, {
      shopId: shop.id,
      personId: crew.id,
      origin: ORIGIN,
    });
    expect(preview).toMatchObject({
      kind: "crew_schedule_change",
      changes: [
        {
          change: "time_moved",
          tripTitle: "Night Dive",
          startsAt: later,
          previousStartsAt: trip.startsAt,
        },
      ],
    });
  });

  it("tells the crew a start time changed on the departure's own page too", async () => {
    const { db, shop, owner, crew, trip } = await crewed(3);
    const later = new Date(trip.startsAt.getTime() + HOUR_MS);
    const patch = {
      title: trip.title,
      endsAt: new Date(trip.endsAt.getTime() + HOUR_MS),
      capacity: trip.capacity,
      plannedDives: 1,
      changeActorPersonId: owner.id,
    };
    // A title-only edit is no news.
    expect(
      (
        await updateTrip(db, shop.id, trip.id, {
          ...patch,
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
        })
      ).ok,
    ).toBe(true);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(0);
    expect((await updateTrip(db, shop.id, trip.id, { ...patch, startsAt: later })).ok).toBe(true);
    const preview = await previewCrewNotices(db, {
      shopId: shop.id,
      personId: crew.id,
      origin: ORIGIN,
    });
    expect(preview).toMatchObject({
      changes: [{ change: "time_moved", startsAt: later, previousStartsAt: trip.startsAt }],
    });
  });

  it("says nothing when the time is unchanged", async () => {
    const { db, shop, owner, crew, trip } = await crewed(3);
    await moveTrip(db, shop.id, trip.id, trip.startsAt, { actorPersonId: owner.id });
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(0);
  });

  it("says nothing about a move undone before it settled", async () => {
    const { db, shop, owner, crew, trip } = await crewed(3);
    const as = { actorPersonId: owner.id };
    await moveTrip(db, shop.id, trip.id, new Date(trip.startsAt.getTime() + HOUR_MS), as);
    await moveTrip(db, shop.id, trip.id, trip.startsAt, as);
    const { sent, provider } = recorder();
    await sendDueCrewNotices(db, { now: settled(), provider, origin: ORIGIN });
    expect(sent.filter((n) => n.to.startsWith("crew-"))).toEqual([]);
    const rows = await db.select().from(crewNotices).where(eq(crewNotices.personId, crew.id));
    expect(rows.filter((row) => row.change === "time_moved").map((row) => row.outcome)).toEqual([
      "netted",
      "netted",
    ]);
  });

  it("tells them at once when a departure leaving within the day is moved away from it", async () => {
    const { db, shop, owner, crew, trip } = await crewed(3);
    // Six hours before it was due to leave, it is moved a week out: the new
    // time is not urgent, the time the crew knew is — so the move's own flush
    // claims the news then and there instead of leaving it for the hour.
    const now = new Date(trip.startsAt.getTime() - 6 * HOUR_MS);
    const nextWeek = new Date(trip.startsAt.getTime() + 7 * DAY_MS);
    expect(
      (await moveTrip(db, shop.id, trip.id, nextWeek, { actorPersonId: owner.id, now })).ok,
    ).toBe(true);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(0);
    const [row] = await db
      .select()
      .from(crewNotices)
      .where(and(eq(crewNotices.personId, crew.id), eq(crewNotices.change, "time_moved")));
    expect(row?.settledAt).toEqual(now);
    expect(row?.previousStartsAt).toEqual(trip.startsAt);
  });

  it("leaves a move with both times days out for the hourly pass", async () => {
    const { db, shop, owner, crew, trip } = await crewed(3);
    await moveTrip(db, shop.id, trip.id, new Date(trip.startsAt.getTime() + DAY_MS), {
      actorPersonId: owner.id,
    });
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(1);
    const { sent, provider } = recorder();
    await flushUrgentCrewNotices(db, {
      shopId: shop.id,
      tripIds: [trip.id],
      provider,
      origin: ORIGIN,
    });
    expect(sent.filter((n) => n.to.startsWith("crew-"))).toEqual([]);
    expect(await countPendingCrewNotices(db, shop.id, crew.id)).toBe(1);
  });
});
