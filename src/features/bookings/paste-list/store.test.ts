// @vitest-environment node
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "../../../db/people";
import { bookings, people, personRoles, trips as tripsTable } from "../../../db/schema/index";
import { upcomingTripsWithCounts } from "../../../db/trips-queries.test-support";
import { fileScopedShopContext } from "../../../test/db";
import { matchPastedPeople, PASTE_NEW_PERSON, seatPastedList } from "./store";

const ctx = fileScopedShopContext();

const OTHER_SHOP_ID = "99999999-9999-4999-8999-999999999999";

async function context() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, ["owner", "manager"])))
    .limit(1);
  if (!staff) throw new Error("seed has no staff actor");
  /** Leave exactly `free` seats on the open departure. */
  const { id, booked } = open;
  async function leaveSeats(free: number) {
    await db
      .update(tripsTable)
      .set({ capacity: booked + free })
      .where(eq(tripsTable.id, id));
  }
  return { db, shop, open, actorPersonId: staff.id, leaveSeats };
}

async function onFile(fullName: string, contact: { email?: string; phone?: string } = {}) {
  return createPerson(ctx.db, {
    shopId: ctx.shop.id,
    fullName,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    origin: "counter",
  });
}

async function seatsOn(tripId: string, personIds: string[]) {
  return ctx.db
    .select({ personId: bookings.personId, unconfirmed: bookings.identityUnconfirmedAt })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), inArray(bookings.personId, personIds)));
}

/**
 * **A pasted trip list** ("Try it Saturday", item 1): who on the list is
 * already on file, with a default per row, and everybody seated on a booking
 * of their own, the ones who cannot be seated named and skipped.
 */
describe("matchPastedPeople", () => {
  it("defaults to the diver on file when the email or number is theirs and the name agrees", async () => {
    const { db, shop } = await context();
    const marta = await onFile("Marta Quillfeather", { email: "marta@quill.test" });
    const tomas = await onFile("Tomas Brightwater", { phone: "+13055550177" });

    const [byEmail, byPhone] = await matchPastedPeople(db, shop.id, [
      { fullName: "marta quillfeather", email: "marta@quill.test" },
      { fullName: "Tomas Brightwater", phone: "(305) 555-0177" },
    ]);

    expect(byEmail?.choice).toBe(marta.id);
    expect(byEmail?.candidates[0]).toMatchObject({ id: marta.id, byContact: true });
    expect(byPhone?.choice).toBe(tomas.id);
  });

  it("offers a contact match under another name, and a namesake, without picking either", async () => {
    const { db, shop } = await context();
    const sharedInbox = await onFile("Inez Quillfeather", { email: "family@quill.test" });
    const namesake = await onFile("Bruno Quillfeather");

    const [sibling, sameName, stranger] = await matchPastedPeople(db, shop.id, [
      { fullName: "Rosa Pennywhistle", email: "family@quill.test" },
      { fullName: "Bruno Quillfeather" },
      { fullName: "Zebedee Nobody-Here" },
    ]);

    expect(sibling?.choice).toBe(PASTE_NEW_PERSON);
    expect(sibling?.candidates).toContainEqual(
      expect.objectContaining({ id: sharedInbox.id, byContact: true }),
    );
    expect(sameName?.choice).toBe(PASTE_NEW_PERSON);
    expect(sameName?.candidates).toContainEqual(
      expect.objectContaining({ id: namesake.id, byContact: false }),
    );
    expect(stranger).toEqual({ candidates: [], choice: PASTE_NEW_PERSON });
  });

  it("never offers somebody from another shop", async () => {
    const { db } = await context();
    await onFile("Marta Quillfeather", { email: "marta@quill.test" });
    const [row] = await matchPastedPeople(db, OTHER_SHOP_ID, [
      { fullName: "Marta Quillfeather", email: "marta@quill.test" },
    ]);
    expect(row).toEqual({ candidates: [], choice: PASTE_NEW_PERSON });
  });
});

describe("seatPastedList", () => {
  it("seats everybody on a booking of their own, on file or new", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const marta = await onFile("Marta Quillfeather", { email: "marta@quill.test" });

    const outcomes = await seatPastedList(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      rows: [
        { row: 2, fullName: "Marta Quillfeather", email: "marta@quill.test", choice: marta.id },
        { row: 3, fullName: "Rosa Pennywhistle", phone: "+1 305 555 0188", choice: "new" },
        { row: 4, fullName: "Ugo Saltmarsh", choice: "new" },
      ],
    });

    expect(outcomes.map((outcome) => [outcome.row, outcome.ok])).toEqual([
      [2, true],
      [3, true],
      [4, true],
    ]);
    const seated = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.bookingId] : []));
    expect(new Set(seated).size).toBe(3);
    const [martaSeat] = await seatsOn(open.id, [marta.id]);
    expect(martaSeat?.unconfirmed).toBeNull();
  });

  it("holds a seat picked from a namesake whose name disagrees, and keeps going", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const namesake = await onFile("Bruno Quillfeathers");

    const outcomes = await seatPastedList(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      rows: [
        { row: 1, fullName: "Bruno Quillfeather", choice: namesake.id },
        { row: 2, fullName: "Ugo Saltmarsh", choice: "new" },
      ],
    });

    expect(outcomes[0]).toMatchObject({ ok: true, held: true });
    expect(outcomes[1]).toMatchObject({ ok: true, held: false });
  });

  it("refuses a chosen record the row could not have been offered, and seats the rest", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const unrelated = await onFile("Somebody Entirely Different", { email: "other@quill.test" });

    const outcomes = await seatPastedList(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      rows: [
        { row: 1, fullName: "Rosa Pennywhistle", choice: unrelated.id },
        { row: 2, fullName: "Ugo Saltmarsh", choice: "new" },
      ],
    });

    expect(outcomes[0]).toEqual({
      ok: false,
      row: 1,
      fullName: "Rosa Pennywhistle",
      reason: "person_not_found",
    });
    expect(outcomes[1]).toMatchObject({ ok: true });
    expect(await seatsOn(open.id, [unrelated.id])).toEqual([]);
  });

  it("names who could not be seated when the boat fills, and seats who fits", async () => {
    const { db, shop, open, actorPersonId, leaveSeats } = await context();
    await leaveSeats(2);

    const outcomes = await seatPastedList(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      rows: ["Ana Saltmarsh", "Ben Saltmarsh", "Carla Saltmarsh"].map((fullName, index) => ({
        row: index + 1,
        fullName,
        choice: "new",
      })),
    });

    expect(outcomes.map((outcome) => (outcome.ok ? "seated" : outcome.reason))).toEqual([
      "seated",
      "seated",
      "trip_full",
    ]);
  });

  it("refuses a diver already on the departure by name, not the whole list", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const marta = await onFile("Marta Quillfeather", { email: "marta@quill.test" });
    const rows = [
      { row: 1, fullName: "Marta Quillfeather", email: "marta@quill.test", choice: marta.id },
    ];
    await seatPastedList(db, { shopId: shop.id, tripId: open.id, actorPersonId, rows });

    const again = await seatPastedList(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      rows: [...rows, { row: 2, fullName: "Ugo Saltmarsh", choice: "new" }],
    });

    expect(again.map((outcome) => (outcome.ok ? "seated" : outcome.reason))).toEqual([
      "already_booked",
      "seated",
    ]);
  });
});
