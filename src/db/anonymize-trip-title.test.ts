import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import { bookings, people, personRoles, shops, trips } from "./schema";

const ctx = fileScopedShopContext({ history: true });

/**
 * A departure titled with a diver's name ("Smith family charter") kept that
 * name after the diver was erased (issue #2315). Aaron, 2026-10-13: when the
 * erased diver's party is the only one booked on a departure and its title
 * names them (a private one: full or family name, case-insensitively; a public
 * one: the full name as whole words), the title becomes a neutral one from the
 * bundle; a departure anyone else is booked on keeps its title.
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

async function departure(
  db: AppDb,
  shopId: string,
  title: string,
  options: { isPrivate?: boolean; deleted?: boolean } = {},
) {
  const startsAt = new Date("2026-11-20T13:00:00Z");
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
      capacity: 8,
      isPrivate: options.isPrivate ?? false,
      deletedAt: options.deleted ? startsAt : null,
    })
    .returning({ id: trips.id });
  if (!row) throw new Error("fixture insert failed");
  return row;
}

async function seat(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
  extra: { partyLeadBookingId?: string; status?: "booked" | "cancelled" } = {},
) {
  const [row] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId, ...extra })
    .returning({ id: bookings.id });
  if (!row) throw new Error("fixture insert failed");
  return row;
}

async function titleOf(db: AppDb, tripId: string) {
  const [row] = await db
    .select({ title: trips.title })
    .from(trips)
    // diveday:allow-deleted-trips: the test reads a deleted departure's title too.
    .where(eq(trips.id, tripId));
  return row?.title;
}

async function erase(db: AppDb, shopId: string, personId: string) {
  const actor = await owner(db, shopId);
  const result = await anonymizeDiver(db, { shopId, personId, actorPersonId: actor.id });
  expect(result.ok).toBe(true);
}

const t = staffTranslator("en-US");
const PRIVATE_TITLE = t("trips.erasedTitle.private");
const PUBLIC_TITLE = t("trips.erasedTitle.public");

describe("anonymizeDiver — a departure titled with the erased diver's name (issue #2315)", () => {
  it("retitles a private charter only their party is booked on", async () => {
    const { db, shop } = ctx;
    const lead = await diver(db, shop.id, "Grace Okafor-Smith");
    const child = await diver(db, shop.id, "Tobi Okafor-Smith");
    const trip = await departure(db, shop.id, "okafor-smith family charter", { isPrivate: true });
    const leadSeat = await seat(db, shop.id, trip.id, lead.id);
    await seat(db, shop.id, trip.id, child.id, { partyLeadBookingId: leadSeat.id });

    await erase(db, shop.id, lead.id);

    expect(await titleOf(db, trip.id)).toBe(PRIVATE_TITLE);
  });

  it("matches the full name anywhere in the title, whatever its case", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Ines Duarte");
    const trip = await departure(db, shop.id, "Wreck day for INES DUARTE");
    await seat(db, shop.id, trip.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, trip.id)).toBe(PUBLIC_TITLE);
  });

  it("reaches a deleted departure and one whose only seat was cancelled", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Pablo Esquivel");
    const gone = await departure(db, shop.id, "Pablo Esquivel charter", { deleted: true });
    const called = await departure(db, shop.id, "Esquivel sunrise", { isPrivate: true });
    await seat(db, shop.id, gone.id, person.id);
    await seat(db, shop.id, called.id, person.id, { status: "cancelled" });

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, gone.id)).toBe(PUBLIC_TITLE);
    expect(await titleOf(db, called.id)).toBe(PRIVATE_TITLE);
  });

  it("leaves a shared departure's title alone, even when it names them", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Nora Lindqvist");
    const stranger = await diver(db, shop.id, "Omar Haddad");
    const trip = await departure(db, shop.id, "Lindqvist and friends", { isPrivate: true });
    await seat(db, shop.id, trip.id, person.id);
    await seat(db, shop.id, trip.id, stranger.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, trip.id)).toBe("Lindqvist and friends");
  });

  it("leaves the title of a party they joined but did not lead", async () => {
    const { db, shop } = ctx;
    const organizer = await diver(db, shop.id, "Bea Marchetti");
    const guest = await diver(db, shop.id, "Luca Marchetti");
    const trip = await departure(db, shop.id, "Marchetti reunion", { isPrivate: true });
    const lead = await seat(db, shop.id, trip.id, organizer.id);
    await seat(db, shop.id, trip.id, guest.id, { partyLeadBookingId: lead.id });

    await erase(db, shop.id, guest.id);

    expect(await titleOf(db, trip.id)).toBe("Marchetti reunion");
  });

  it("leaves a title that does not name them, and a departure they never booked", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Hana Kobayashi");
    const theirs = await departure(db, shop.id, "Blue hole private", { isPrivate: true });
    const notTheirs = await departure(db, shop.id, "Kobayashi charter", { isPrivate: true });
    await seat(db, shop.id, theirs.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, theirs.id)).toBe("Blue hole private");
    expect(await titleOf(db, notTheirs.id)).toBe("Kobayashi charter");
  });

  it("never reaches another shop's departure", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-trip-title", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!other) throw new Error("fixture insert failed");
    const person = await diver(db, shop.id, "Yara Castellanos");
    const twin = await diver(db, other.id, "Yara Castellanos");
    const ours = await departure(db, shop.id, "Castellanos charter", { isPrivate: true });
    const theirs = await departure(db, other.id, "Castellanos charter", { isPrivate: true });
    await seat(db, shop.id, ours.id, person.id);
    await seat(db, other.id, theirs.id, twin.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, ours.id)).toBe(PRIVATE_TITLE);
    expect(await titleOf(db, theirs.id)).toBe("Castellanos charter");
  });

  it("writes the neutral title in the shop's own language", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
    const person = await diver(db, shop.id, "Rafa Benítez");
    const trip = await departure(db, shop.id, "Benítez privado", { isPrivate: true });
    await seat(db, shop.id, trip.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, trip.id)).toBe(staffTranslator("es-ES")("trips.erasedTitle.private"));
    expect(await titleOf(db, trip.id)).not.toBe(PRIVATE_TITLE);
  });

  it("does not use a family name too short to match safely", async () => {
    const { db, shop } = ctx;
    const person = await diver(db, shop.id, "Mai Ng");
    const trip = await departure(db, shop.id, "Night dive at Angel reef", { isPrivate: true });
    await seat(db, shop.id, trip.id, person.id);

    await erase(db, shop.id, person.id);

    expect(await titleOf(db, trip.id)).toBe("Night dive at Angel reef");
  });
});
