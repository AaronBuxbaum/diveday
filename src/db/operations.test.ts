import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { REDACTED_TEXT } from "@/lib/anonymization";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
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
  pagedDiverActivity,
} from "./operations";
import { activityEvents, people } from "./schema";
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

/**
 * The same append-only table the Guests tab reads, filtered to one person
 * instead of one departure — the question a staffer at the counter actually
 * has. Three things make a line theirs: it happened to a seat of theirs, they
 * did it, or it is about them. That set is not a choice made here; it is the
 * predicate `anonymizeDiver` redacts under, so what a shop can read and what an
 * erasure destroys are the same set by construction.
 */
describe("a diver's own activity trail", () => {
  /** The seeded cast's headline diver — `seed-diver-trail.ts` gives her the long one. */
  async function seededDiver(db: AppDb, shopId: string, fullName: string) {
    const [row] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)));
    if (!row) throw new Error(`seeded person ${fullName} missing`);
    return row.id;
  }

  it("reads one person's lines newest first, a page at a time", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await seededDiver(db, shop.id, "Priya Sharma");

    const first = await pagedDiverActivity(db, shop.id, priya, { pageSize: 5 });
    expect(first.rows).toHaveLength(5);
    expect(first.total).toBeGreaterThan(5);
    expect(first.page).toBe(1);
    const times = first.rows.map((row) => row.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // Every line is about her by name — the seeded desk trail's own shape.
    for (const row of first.rows) expect(row.message).toContain("Priya Sharma");

    // Page two is the next slice, not the same one again.
    const second = await pagedDiverActivity(db, shop.id, priya, { page: 2, pageSize: 5 });
    expect(second.page).toBe(2);
    expect(second.rows.map((row) => row.id)).not.toEqual(first.rows.map((row) => row.id));
    expect(second.total).toBe(first.total);
  });

  it("lands a request past the end on the last real page, never on an empty one", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await seededDiver(db, shop.id, "Priya Sharma");

    const far = await pagedDiverActivity(db, shop.id, priya, { page: 99, pageSize: 5 });
    expect(far.page).toBe(far.pageCount);
    expect(far.rows.length).toBeGreaterThan(0);
  });

  it("carries what a person did, not only what was done about them", async () => {
    const { db, shop } = await seededShopContext();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => row.booked > 0);
    if (!trip) throw new Error("expected a booked trip");
    const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
    const [actor] = await listStaff(db, shop.id);
    if (!rosterEntry || !actor) throw new Error("expected seeded people");

    await addInternalNote(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: rosterEntry.booking.id,
      actorPersonId: actor.person.id,
      body: "Bringing their own computer.",
    });

    // The staffer's own trail — a divemaster's work across every boat they ran,
    // which is the other half of what this table records.
    const theirs = await pagedDiverActivity(db, shop.id, actor.person.id);
    expect(
      theirs.rows.some((row) =>
        row.message.startsWith(`${actor.person.fullName} added a private note`),
      ),
    ).toBe(true);
  });

  it("never reaches another shop's trail through the same person id", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await seededDiver(db, shop.id, "Priya Sharma");
    const otherShopId = "99999999-8888-4777-8666-555555555555";

    expect((await pagedDiverActivity(db, shop.id, priya)).total).toBeGreaterThan(0);
    expect(await pagedDiverActivity(db, otherShopId, priya)).toMatchObject({
      total: 0,
      rows: [],
    });

    // A malformed id is an empty trail, never a raised `invalid input syntax
    // for type uuid` — which Postgres would turn into a 500 on a page whose
    // own notFound() is two lines further down.
    expect(await pagedDiverActivity(db, shop.id, "not-a-uuid")).toMatchObject({
      total: 0,
      rows: [],
    });
  });

  /**
   * The reader does no redaction of its own, and must not: an erased person's
   * lines are rewritten to `[redacted]` once, inside the erasure transaction
   * (`src/db/anonymize.ts`). A read-time filter would be a second, weaker copy
   * of that rule — and the weaker copy is the one that gets forgotten. This
   * asserts the outcome the staffer sees either way.
   */
  it("still reads redacted once the person has been erased", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await seededDiver(db, shop.id, "Priya Sharma");
    const owner = await seededDiver(db, shop.id, "Dana Reyes");
    expect((await pagedDiverActivity(db, shop.id, priya)).total).toBeGreaterThan(0);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: priya,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);

    const after = await pagedDiverActivity(db, shop.id, priya, { pageSize: 50 });
    expect(after.rows.length).toBeGreaterThan(0);
    for (const row of after.rows) expect(row.message).toBe(REDACTED_TEXT);
  });

  /**
   * The reported failure: a note written on a diver's record hangs off no seat
   * and is written by a staffer, so neither of the two seat-shaped handles
   * claims it — it landed on the trail of whoever wrote it and never on the
   * record it was written on. `subject_person_id` is what claims it now.
   */
  it("puts a note written on a diver's record on that diver's trail, and on the writer's", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await seededDiver(db, shop.id, "Priya Sharma");
    const [actor] = await listStaff(db, shop.id);
    if (!actor) throw new Error("expected seeded staff");

    const before = await pagedDiverActivity(db, shop.id, priya, { pageSize: 100 });
    const note = await addDiverNote(db, {
      shopId: shop.id,
      personId: priya,
      actorPersonId: actor.person.id,
      body: "Keeps her own logbook; ask before writing in it.",
    });
    if (!note) throw new Error("expected the diver note to be created");

    const added = `${actor.person.fullName} added a private note about Priya Sharma`;
    const after = await pagedDiverActivity(db, shop.id, priya, { pageSize: 100 });
    expect(after.total).toBe(before.total + 1);
    expect(after.rows[0]?.message).toBe(added);
    // Still on the writer's own trail too — the actor handle is unchanged.
    const writersTrail = await pagedDiverActivity(db, shop.id, actor.person.id, { pageSize: 100 });
    expect(writersTrail.rows.some((row) => row.message === added)).toBe(true);

    // The matching delete line lands on the same record, not only on the writer's.
    await expect(
      deleteDiverNote(db, {
        shopId: shop.id,
        personId: priya,
        noteId: note.id,
        actorPersonId: actor.person.id,
      }),
    ).resolves.toMatchObject({ deleted: true });
    const afterDelete = await pagedDiverActivity(db, shop.id, priya, { pageSize: 100 });
    expect(afterDelete.rows[0]?.message).toBe(
      `${actor.person.fullName} deleted a private note about Priya Sharma`,
    );
  });

  /**
   * The pairing, proven rather than restored: whatever handle claims a line for
   * a person, an erasure of that person destroys its wording. The row inserted
   * here is reachable **only** through `subject_person_id` — a different actor,
   * no booking, and a message that never spells her name, so the erasure
   * sweep's fuzzy name pass cannot reach it either. Drop the subject clause
   * from that sweep and this fails while the reader still hands the line back.
   */
  it("destroys every line the trail claims, whichever handle claims it", async () => {
    const { db, shop } = await seededShopContext();
    const priya = await seededDiver(db, shop.id, "Priya Sharma");
    const owner = await seededDiver(db, shop.id, "Dana Reyes");
    const [actor] = await listStaff(db, shop.id);
    if (!actor) throw new Error("expected seeded staff");

    await addDiverNote(db, {
      shopId: shop.id,
      personId: priya,
      actorPersonId: actor.person.id,
      body: "Prefers the second wave.",
    });
    const subjectOnly = "A staffer corrected a rental size on a record";
    await db.insert(activityEvents).values({
      shopId: shop.id,
      actorPersonId: owner,
      subjectPersonId: priya,
      message: subjectOnly,
    });

    const claimed = await pagedDiverActivity(db, shop.id, priya, { pageSize: 200 });
    expect(claimed.rows.some((row) => row.message === subjectOnly)).toBe(true);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: priya,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);

    const after = await pagedDiverActivity(db, shop.id, priya, { pageSize: 200 });
    expect(after.total).toBe(claimed.total);
    for (const row of after.rows) expect(row.message).toBe(REDACTED_TEXT);
  });
});
