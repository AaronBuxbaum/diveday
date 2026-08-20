import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  addDiverNote,
  addInternalNote,
  deleteDiverNote,
  deleteInternalNote,
  listBookingNotes,
  listDiverNotes,
  listDiverNotesForTrip,
  listDiverRecordNotes,
  listTripActivity,
} from "./operations";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

describe("staff-only operational context", () => {
  it("saves a private booking note before boarding and records a plain-language activity event", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        tripId: trip.id,
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

  it("reads a same-instant trail newest-first, whatever order the heap returns", async () => {
    // Adding then deleting a note writes two events. Under the frozen test
    // clock they carry the *identical* `occurred_at`, so time alone cannot
    // order them and Postgres is free to hand back whichever row it reaches
    // first — which changes the moment anything moves rows on disk. A VACUUM
    // does exactly that, and it flipped this list in the visual baseline:
    // "deleted a private note" rendered above the "added" it followed.
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    const note = await addInternalNote(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Bring the spare mask strap.",
    });
    if (!note) throw new Error("expected the note to be created");
    await deleteInternalNote(db, {
      shopId: shop.id,
      tripId: trip.id,
      noteId: note.id,
      actorPersonId: actor.person.id,
    });

    const trail = await listTripActivity(db, shop.id, trip.id);
    const [newest, next] = trail;
    // Both share an instant, so this passes only because `seq` breaks the tie.
    expect(newest?.occurredAt).toEqual(next?.occurredAt);
    expect(newest?.message).toContain("deleted a private note");
    expect(next?.message).toContain("added a private note");

    // And it survives the rows physically moving, which is the whole point.
    await db.execute(sql`vacuum full activity_events`);
    expect((await listTripActivity(db, shop.id, trip.id)).map((row) => row.message)).toEqual(
      trail.map((row) => row.message),
    );
  });

  it("refuses blank notes and cross-shop booking access", async () => {
    const { db, shop } = await seededShopContext();
    const [actor] = await listStaff(db, shop.id);
    if (!actor) throw new Error("expected seeded staff");
    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        tripId: "00000000-0000-4000-8000-000000000099",
        bookingId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
        body: "note",
      }),
    ).resolves.toBeNull();
    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        tripId: "not-a-uuid",
        bookingId: "not-a-uuid",
        actorPersonId: actor.person.id,
        body: "note",
      }),
    ).resolves.toBeNull();
    await expect(
      addInternalNote(db, {
        shopId: shop.id,
        tripId: "00000000-0000-4000-8000-000000000099",
        bookingId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
        body: "   ",
      }),
    ).resolves.toBeNull();
  });

  it("shares a diver note between the diver record and a trip manifest", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    const note = await addDiverNote(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      actorPersonId: actor.person.id,
      body: "  First boat dive since certification; keep the briefing unhurried.  ",
    });
    expect(note).toMatchObject({
      personId: rosterEntry.person.id,
      bookingId: null,
      body: "First boat dive since certification; keep the briefing unhurried.",
    });
    if (!note) throw new Error("expected the diver note to be created");

    expect(await listDiverNotes(db, shop.id, rosterEntry.person.id)).toHaveLength(1);
    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(0);
    expect(await listDiverNotesForTrip(db, shop.id, trip.id)).toEqual([
      expect.objectContaining({
        bookingId: rosterEntry.booking.id,
        authorName: actor.person.fullName,
      }),
    ]);

    const bookingNote = await addInternalNote(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Bring their preferred mask from the desk bin.",
    });
    if (!bookingNote) throw new Error("expected the booking note to be created");
    const recordNotes = await listDiverRecordNotes(db, shop.id, rosterEntry.person.id);
    expect(recordNotes).toHaveLength(2);
    expect(recordNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          note: expect.objectContaining({ id: note.id, bookingId: null }),
          tripId: null,
          tripTitle: null,
        }),
        expect.objectContaining({
          note: expect.objectContaining({ id: bookingNote.id, bookingId: rosterEntry.booking.id }),
          tripId: trip.id,
          tripTitle: trip.title,
        }),
      ]),
    );
  });

  it("deletes a diver note without touching booking-scoped notes", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    const note = await addDiverNote(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      actorPersonId: actor.person.id,
      body: "Remove after the trip.",
    });
    if (!note) throw new Error("expected note to be created");

    await expect(
      deleteDiverNote(db, {
        shopId: shop.id,
        personId: rosterEntry.person.id,
        noteId: note.id,
        actorPersonId: actor.person.id,
      }),
    ).resolves.toEqual({ deleted: true, body: "Remove after the trip." });
    expect(await listDiverNotes(db, shop.id, rosterEntry.person.id)).toHaveLength(0);
    expect(
      (await listTripActivity(db, shop.id, trip.id)).some((row) => row.message.includes(note.body)),
    ).toBe(false);
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
      tripId: trip.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Needs a size-large wetsuit.",
    });
    if (!note) throw new Error("expected note to be created");

    await expect(
      deleteInternalNote(db, {
        shopId: shop.id,
        tripId: trip.id,
        noteId: note.id,
        actorPersonId: actor.person.id,
      }),
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
      tripId: trip.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Bring a spare mask for their kid.",
    });
    if (!note) throw new Error("expected note to be created");

    const result = await deleteInternalNote(db, {
      shopId: shop.id,
      tripId: trip.id,
      noteId: note.id,
      actorPersonId: actor.person.id,
    });
    if (!result.deleted) throw new Error("expected the note to be deleted");
    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(0);

    // The restore recreates a *new* note with the deleted one's content — the
    // old row's id is gone and isn't needed for that.
    const restored = await addInternalNote(db, {
      shopId: shop.id,
      tripId: trip.id,
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
        tripId: "00000000-0000-4000-8000-000000000099",
        noteId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: actor.person.id,
      }),
    ).resolves.toEqual({ deleted: false });
    await expect(
      deleteInternalNote(db, {
        shopId: shop.id,
        tripId: "not-a-uuid",
        noteId: "not-a-uuid",
        actorPersonId: actor.person.id,
      }),
    ).resolves.toEqual({ deleted: false });

    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    if (!rosterEntry) throw new Error("expected a seeded booking");
    const note = await addInternalNote(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Cross-shop deletion attempt target.",
    });
    if (!note) throw new Error("expected note to be created");

    await expect(
      deleteInternalNote(db, {
        shopId: otherShopId,
        tripId: trip.id,
        noteId: note.id,
        actorPersonId: actor.person.id,
      }),
    ).resolves.toEqual({ deleted: false });
    expect(await listBookingNotes(db, shop.id, trip.id)).toHaveLength(1);
  });
});
