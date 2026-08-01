// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  addInternalNote,
  deleteInternalNote,
  listBookingNotes,
  listTripActivity,
} from "./operations";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

describe("staff-only operational context", () => {
  it("adds a private booking note and a plain-language activity event", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        bookingId: rosterEntry.booking.id,
        actorPersonId: actor.person.id,
        body: "  Prefers the shaded bench during setup.  ",
      }),
    ).resolves.toMatchObject({ body: "Prefers the shaded bench during setup." });

    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(1);
    expect((await listTripActivity(db, shop.id, trip.id))[0]?.message).toBe(
      `${actor.person.fullName} added a private note about ${rosterEntry.person.fullName}`,
    );
  });

  it("refuses blank notes and cross-shop booking access", async () => {
    const { db, shop } = await seededShopContext();
    const [actor] = await listStaff(db, shop.id);
    if (!actor) throw new Error("expected seeded staff");
    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        bookingId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
        body: "note",
      }),
    ).resolves.toBeNull();
    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        bookingId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
        body: "   ",
      }),
    ).resolves.toBeNull();
  });

  it("deletes a private booking note and records a plain-language activity event", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    const note = await addInternalNote(db, {
      shopId: shop.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Needs a size-large wetsuit.",
    });
    if (!note) throw new Error("expected note to be created");

    await expect(
      deleteInternalNote(db, { shopId: shop.id, noteId: note.id, actorPersonId: actor.person.id }),
    ).resolves.toEqual({
      deleted: true,
      bookingId: rosterEntry.booking.id,
      body: "Needs a size-large wetsuit.",
    });
    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(0);
    expect((await listTripActivity(db, shop.id, trip.id))[0]?.message).toBe(
      `${actor.person.fullName} deleted a private note about ${rosterEntry.person.fullName}`,
    );
  });

  it("returns the deleted note's booking and text so a land-then-undo toast can recreate it", async () => {
    // Regression for the roster's delete-then-undo flow (docs/design/principles.md
    // §7): `deleteInternalNoteAction` reads this return value straight into the
    // redirect that drives the toast, and `restoreInternalNoteAction` reuses
    // `addInternalNote` with exactly these fields to recreate the note.
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    const note = await addInternalNote(db, {
      shopId: shop.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Bring a spare mask for their kid.",
    });
    if (!note) throw new Error("expected note to be created");

    const result = await deleteInternalNote(db, {
      shopId: shop.id,
      noteId: note.id,
      actorPersonId: actor.person.id,
    });
    if (!result.deleted) throw new Error("expected the note to be deleted");
    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(0);

    // The restore recreates a *new* note with the deleted one's content — the
    // old row's id is gone and isn't needed for that.
    const restored = await addInternalNote(db, {
      shopId: shop.id,
      bookingId: result.bookingId,
      actorPersonId: actor.person.id,
      body: result.body,
    });
    expect(restored).toMatchObject({ body: "Bring a spare mask for their kid." });
    expect(restored?.id).not.toBe(note.id);
    const notesAfterRestore = await listBookingNotes(db, shop.id, trip.id);
    expect(notesAfterRestore).toHaveLength(1);
    expect(notesAfterRestore[0]?.note.body).toBe("Bring a spare mask for their kid.");
  });

  it("refuses to delete a note that doesn't exist or belongs to another shop", async () => {
    const { db, shop } = await seededShopContext();
    const otherShopId = "99999999-8888-4777-8666-555555555555";
    const [actor] = await listStaff(db, shop.id);
    if (!actor) throw new Error("expected seeded staff");

    await expect(
      deleteInternalNote(db, {
        shopId: shop.id,
        noteId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
      }),
    ).resolves.toEqual({ deleted: false });

    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    if (!rosterEntry) throw new Error("expected a seeded booking");
    const note = await addInternalNote(db, {
      shopId: shop.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Cross-shop deletion attempt target.",
    });
    if (!note) throw new Error("expected note to be created");

    await expect(
      deleteInternalNote(db, {
        shopId: otherShopId,
        noteId: note.id,
        actorPersonId: actor.person.id,
      }),
    ).resolves.toEqual({ deleted: false });
    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(1);
  });
});
