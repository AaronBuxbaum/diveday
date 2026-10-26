import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { REDACTED_TEXT } from "@/lib/anonymization";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import {
  activityEvents,
  bookings,
  people,
  personRoles,
  reviewModerationEvents,
  tripChangeEvents,
  tripReviews,
  tripSeries,
  trips,
} from "./schema";
import { createTripSeries, rollAllSeriesForward } from "./trips-series";

const ctx = fileScopedShopContext({ history: true });

/**
 * What an erasure leaves on a departure besides its title (reviews of issue
 * #2315): a public departure is renamed only when it names the diver in full,
 * a repeating charter's series row and unbooked dates go with the booked one,
 * each rename leaves an activity line that does not repeat the old title, and
 * the moderation and change trails lose the name too.
 */
async function owner(db: AppDb, shopId: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!row) throw new Error("expected the seeded owner");
  return row;
}

async function diver(db: AppDb, shopId: string, fullName: string) {
  const [row] = await db.insert(people).values({ shopId, fullName }).returning({ id: people.id });
  if (!row) throw new Error("fixture insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  return row;
}

async function departure(db: AppDb, shopId: string, title: string, isPrivate = false) {
  const startsAt = new Date("2026-11-20T13:00:00Z");
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 8,
      isPrivate,
    })
    .returning({ id: trips.id });
  if (!row) throw new Error("fixture insert failed");
  return row;
}

async function seat(db: AppDb, shopId: string, tripId: string, personId: string) {
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId })
    .returning({ id: bookings.id });
  if (!row) throw new Error("fixture insert failed");
  return row;
}

async function titleOf(db: AppDb, tripId: string) {
  const [row] = await db.select({ title: trips.title }).from(trips).where(eq(trips.id, tripId));
  return row?.title;
}

async function erase(db: AppDb, shopId: string, personId: string) {
  const actor = await owner(db, shopId);
  const result = await anonymizeDiver(db, { shopId, personId, actorPersonId: actor.id });
  expect(result.ok).toBe(true);
  return actor;
}

const t = staffTranslator("en-US");

describe("anonymizeDiver — a public departure's title", () => {
  it("keeps a public title that only contains the name inside a word", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Dana Lee");
    const trip = await departure(db, shop.id, "Leeward Wall Dive");
    await seat(db, shop.id, trip.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, trip.id)).toBe("Leeward Wall Dive");
  });

  it("keeps a public title naming only the family, and renames one naming them in full", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Dana Leeson");
    const family = await departure(db, shop.id, "Leeson reef morning");
    const named = await departure(db, shop.id, "Reef morning with Dana Leeson");
    await seat(db, shop.id, family.id, person.id);
    await seat(db, shop.id, named.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, family.id)).toBe("Leeson reef morning");
    expect(await titleOf(db, named.id)).toBe(t("trips.erasedTitle.public"));
  });

  it("renames a public title naming them with extra spaces or family name first", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Dana Lee");
    const spaced = await departure(db, shop.id, "Reef morning with Dana  Lee");
    const register = await departure(db, shop.id, "Lee, Dana: reef morning");
    await seat(db, shop.id, spaced.id, person.id);
    await seat(db, shop.id, register.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, spaced.id)).toBe(t("trips.erasedTitle.public"));
    expect(await titleOf(db, register.id)).toBe(t("trips.erasedTitle.public"));
  });

  it("still renames a private charter that names the family inside a word", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Dana Lee");
    const trip = await departure(db, shop.id, "The Lees' charter", true);
    await seat(db, shop.id, trip.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, trip.id)).toBe(t("trips.erasedTitle.private"));
  });
});

describe("anonymizeDiver — a repeating charter named for the diver", () => {
  it("renames the series and its unbooked dates, so the nightly roll adds no named date", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Ruth Abernathy");
    const created = await createTripSeries(db, {
      shopId: shop.id,
      title: "Abernathy Saturday charter",
      capacity: 6,
      plannedDives: 2,
      isPrivate: true,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([6]),
      anchorDate: "2030-09-07",
      endsOn: null,
      timeZone: "UTC",
      template: {
        startsAt: new Date("2030-09-07T11:00:00.000Z"),
        endsAt: new Date("2030-09-07T15:00:00.000Z"),
      },
    });
    if (!created) throw new Error("series not created");
    const [first] = created.trips;
    if (!first) throw new Error("series has no date");
    await seat(db, shop.id, first.id, person.id);

    await erase(db, shop.id, person.id);
    await rollAllSeriesForward(db, new Date("2031-03-01T00:00:00.000Z"));

    const [series] = await db
      .select({ title: tripSeries.title })
      .from(tripSeries)
      .where(eq(tripSeries.id, created.series.id));
    expect(series?.title).toBe(t("trips.erasedTitle.private"));
    const dates = await db
      .select({ title: trips.title })
      .from(trips)
      .where(eq(trips.seriesId, created.series.id));
    expect(dates.length).toBeGreaterThan(created.trips.length);
    expect(dates.filter((row) => /abernathy/i.test(row.title))).toEqual([]);
    const lines = await db
      .select({ tripId: activityEvents.tripId })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.shopId, shop.id),
          eq(activityEvents.code, "departure_retitled_by_erasure"),
        ),
      );
    expect(lines).toEqual([{ tripId: first.id }]);
  });

  it("keeps the series' name when someone else is booked on any of its dates", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Iris Vandermeer");
    const stranger = await diver(db, shop.id, "Kofi Mensah");
    const created = await createTripSeries(db, {
      shopId: shop.id,
      title: "Vandermeer weekly",
      capacity: 6,
      plannedDives: 2,
      isPrivate: true,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([6]),
      anchorDate: "2030-09-07",
      endsOn: "2030-09-28",
      timeZone: "UTC",
      template: {
        startsAt: new Date("2030-09-07T11:00:00.000Z"),
        endsAt: new Date("2030-09-07T15:00:00.000Z"),
      },
    });
    if (!created) throw new Error("series not created");
    const [first, second] = created.trips;
    if (!first || !second) throw new Error("series too short");
    await seat(db, shop.id, first.id, person.id);
    await seat(db, shop.id, second.id, stranger.id);

    await erase(db, shop.id, person.id);

    const [series] = await db
      .select({ title: tripSeries.title })
      .from(tripSeries)
      .where(eq(tripSeries.id, created.series.id));
    expect(series?.title).toBe("Vandermeer weekly");
    expect(await titleOf(db, first.id)).toBe(t("trips.erasedTitle.private"));
    expect(await titleOf(db, second.id)).toBe("Vandermeer weekly");
  });
});

describe("anonymizeDiver — the trace a rename leaves", () => {
  it("writes one activity line per renamed departure, by the erasing staffer, without the old title", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Selma Quist");
    const renamed = await departure(db, shop.id, "Quist charter", true);
    const kept = await departure(db, shop.id, "Blue hole", true);
    await seat(db, shop.id, renamed.id, person.id);
    await seat(db, shop.id, kept.id, person.id);

    const actor = await erase(db, shop.id, person.id);

    const lines = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.shopId, shop.id),
          eq(activityEvents.code, "departure_retitled_by_erasure"),
        ),
      );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tripId: renamed.id, actorPersonId: actor.id });
    expect(JSON.stringify(lines[0]?.params)).not.toMatch(/quist/i);
  });
});

describe("anonymizeDiver — the moderation and change trails", () => {
  it("redacts the reason note on the diver's own reviews and any note naming them", async () => {
    const { db, shop } = ctx;
    const actor = await owner(db, shop.id);
    const person = await diver(db, shop.id, "Teodor Halvorsen");
    const other = await diver(db, shop.id, "Mina Park");
    const trip = await departure(db, shop.id, "Reef morning");
    const ownSeat = await seat(db, shop.id, trip.id, person.id);
    const otherSeat = await seat(db, shop.id, trip.id, other.id);
    const [own, theirs] = await db
      .insert(tripReviews)
      .values([
        { shopId: shop.id, bookingId: ownSeat.id, tripId: trip.id, personId: person.id, rating: 2 },
        {
          shopId: shop.id,
          bookingId: otherSeat.id,
          tripId: trip.id,
          personId: other.id,
          rating: 1,
        },
      ])
      .returning({ id: tripReviews.id });
    if (!own || !theirs) throw new Error("fixture insert failed");
    const note = (reviewId: string, reasonNote: string) => ({
      shopId: shop.id,
      reviewId,
      action: "hidden" as const,
      reason: "other" as const,
      reasonNote,
      recordedByPersonId: actor.id,
    });
    const [onOwn, naming, unrelated, family, register] = await db
      .insert(reviewModerationEvents)
      .values([
        note(own.id, "Rude about the crew"),
        note(theirs.id, "Blames Teodor Halvorsen by name"),
        note(theirs.id, "Off topic"),
        note(theirs.id, "Says Halvorsen was rude"),
        note(theirs.id, "Copied from the register: Halvorsen, Teodor"),
      ])
      .returning({ id: reviewModerationEvents.id });
    if (!onOwn || !naming || !unrelated || !family || !register) {
      throw new Error("fixture insert failed");
    }

    await erase(db, shop.id, person.id);

    const notes = new Map(
      (
        await db
          .select({ id: reviewModerationEvents.id, note: reviewModerationEvents.reasonNote })
          .from(reviewModerationEvents)
          .where(eq(reviewModerationEvents.shopId, shop.id))
      ).map((row) => [row.id, row.note]),
    );
    expect(notes.get(onOwn.id)).toBe(REDACTED_TEXT);
    expect(notes.get(naming.id)).toBe(REDACTED_TEXT);
    expect(notes.get(unrelated.id)).toBe("Off topic");
    expect(notes.get(family.id)).toBe(REDACTED_TEXT);
    expect(notes.get(register.id)).toBe(REDACTED_TEXT);
  });

  it("redacts a departure change value that names them, keeping the rest of the change", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Teodor Halvorsen");
    const trip = await departure(db, shop.id, "Reef morning");
    await seat(db, shop.id, trip.id, person.id);
    const [naming, unrelated] = await db
      .insert(tripChangeEvents)
      .values([
        {
          shopId: shop.id,
          tripId: trip.id,
          kind: "meeting_point",
          source: "shop",
          beforeValue: { label: "Dock 2", note: null },
          afterValue: {
            label: "Teodor  Halvorsen's house",
            note: "Gate code 12",
            landmark: "Halvorsen's jetty",
          },
        },
        {
          shopId: shop.id,
          tripId: trip.id,
          kind: "conditions",
          source: "crew",
          afterValue: { summary: "Calm" },
        },
      ])
      .returning({ id: tripChangeEvents.id });
    if (!naming || !unrelated) throw new Error("fixture insert failed");

    await erase(db, shop.id, person.id);

    const rows = new Map(
      (await db.select().from(tripChangeEvents).where(eq(tripChangeEvents.shopId, shop.id))).map(
        (row) => [row.id, row],
      ),
    );
    expect(rows.get(naming.id)?.beforeValue).toEqual({ label: "Dock 2", note: null });
    expect(rows.get(naming.id)?.afterValue).toEqual({
      label: REDACTED_TEXT,
      note: "Gate code 12",
      landmark: REDACTED_TEXT,
    });
    expect(rows.get(unrelated.id)?.afterValue).toEqual({ summary: "Calm" });
  });

  it("redacts only the site in a run that names them, keeping the other sites", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Teodor Halvorsen");
    const trip = await departure(db, shop.id, "Reef morning");
    await seat(db, shop.id, trip.id, person.id);
    const [moved] = await db
      .insert(tripChangeEvents)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        kind: "site_change",
        source: "shop",
        beforeValue: { siteNames: "Molasses Reef\nFrench Reef" },
        afterValue: { siteNames: "Halvorsen's Ledge\nMolasses Reef\nHalvorsen's Ledge" },
      })
      .returning({ id: tripChangeEvents.id });
    if (!moved) throw new Error("fixture insert failed");

    await erase(db, shop.id, person.id);

    const [row] = await db.select().from(tripChangeEvents).where(eq(tripChangeEvents.id, moved.id));
    expect(row?.beforeValue).toEqual({ siteNames: "Molasses Reef\nFrench Reef" });
    expect(row?.afterValue).toEqual({
      siteNames: [REDACTED_TEXT, "Molasses Reef", REDACTED_TEXT].join("\n"),
    });
  });
});
