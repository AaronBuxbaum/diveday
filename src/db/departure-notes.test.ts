// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { DEPARTURE_NOTES_PER_DEPARTURE } from "@/lib/departure-notes";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  checkDepartureNote,
  departureNoteAudience,
  listDepartureNotes,
  sendDepartureNote,
} from "./departure-notes";
import { claimHeldSend, executeHeldSend, holdSend } from "./held-sends";
import { activityEvents, departureNotes, people, shops, trips } from "./schema";
import { createTrip, setTripStatus } from "./trips";

/**
 * **A note to everyone on a departure** (batch 4, J4). The message reaches
 * every diver on the boat, so what may be said, and to which departure, is
 * checked at the hold and again at the send.
 */
const ctx = fileScopedShopContext();
const HOUR = 3_600_000;
const NOTE = "Marina lot closed, park at the Elks lodge.";

async function departure(
  db: AppDb,
  shopId: string,
  startsAt = new Date(nowDate().getTime() + 6 * HOUR),
) {
  const trip = await createTrip(db, {
    shopId,
    title: "Note test",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR),
    capacity: 8,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

let seq = 0;
async function book(
  db: AppDb,
  shopId: string,
  tripId: string,
  contact: { email?: string; phone?: string },
) {
  seq += 1;
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: `Note Diver ${seq}`,
    email: contact.email,
    phone: contact.phone,
  });
  if (!outcome.ok) throw new Error(`seat refused: ${outcome.reason}`);
  return outcome;
}

async function actor(db: AppDb, shopId: string) {
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName: "Desk Staffer" })
    .returning({ id: people.id });
  if (!row) throw new Error("actor not inserted");
  return row.id;
}

describe("sendDepartureNote", () => {
  it("sends once to every held seat by its usual channel, and records it", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await book(db, shop.id, trip.id, { email: "note-a@example.com" });
    await book(db, shop.id, trip.id, { phone: "+13055550111" });
    const gone = await book(db, shop.id, trip.id, { email: "note-gone@example.com" });
    await cancelBooking(db, shop.id, gone.bookingId);
    const staffer = await actor(db, shop.id);
    const email = fakeEmail();
    const sms = fakeSms();

    const outcome = await sendDepartureNote(
      db,
      { shopId: shop.id, tripId: trip.id, body: `  ${NOTE}\n`, actorPersonId: staffer },
      { emailProvider: email.provider, smsProvider: sms.provider, whatsAppProviders: new Map() },
    );

    expect(outcome).toMatchObject({ ok: true, recipients: 2, delivered: 2 });
    expect(email.sent.map((n) => n.to)).toEqual(["note-a@example.com"]);
    expect(email.sent[0]).toMatchObject({ kind: "departure_note", body: NOTE });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.body).toContain(NOTE);

    const notes = await listDepartureNotes(db, shop.id, trip.id);
    expect(notes).toEqual([
      expect.objectContaining({
        body: NOTE,
        recipients: 2,
        delivered: 2,
        sentByName: "Desk Staffer",
      }),
    ]);
    const lines = await db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(
        and(eq(activityEvents.tripId, trip.id), eq(activityEvents.code, "departure_note_sent")),
      );
    expect(lines).toHaveLength(1);
  });

  it("refuses a note with a link and sends nothing", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await book(db, shop.id, trip.id, { email: "note-link@example.com" });
    const email = fakeEmail();

    const outcome = await sendDepartureNote(
      db,
      { shopId: shop.id, tripId: trip.id, body: "Map: https://evil.example", actorPersonId: null },
      { emailProvider: email.provider },
    );
    expect(outcome).toEqual({ ok: false, reason: "link" });
    expect(email.sent).toEqual([]);
    expect(await listDepartureNotes(db, shop.id, trip.id)).toEqual([]);
  });

  it("refuses a cancelled departure", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await setTripStatus(db, shop.id, trip.id, "cancelled");
    expect(await checkDepartureNote(db, { shopId: shop.id, tripId: trip.id, body: NOTE })).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("refuses a rehearsal: nothing about one is sent", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await db.update(trips).set({ isRehearsal: true, isPrivate: true }).where(eq(trips.id, trip.id));
    expect(await checkDepartureNote(db, { shopId: shop.id, tripId: trip.id, body: NOTE })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a departure that has sailed", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id, new Date(nowDate().getTime() - 3 * HOUR));
    expect(await checkDepartureNote(db, { shopId: shop.id, tripId: trip.id, body: NOTE })).toEqual({
      ok: false,
      reason: "past",
    });
  });

  it("refuses past the per-departure cap", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await book(db, shop.id, trip.id, { email: "note-cap@example.com" });
    const email = fakeEmail();
    for (let i = 0; i < DEPARTURE_NOTES_PER_DEPARTURE; i += 1) {
      const sent = await sendDepartureNote(
        db,
        { shopId: shop.id, tripId: trip.id, body: `${NOTE} ${i}`, actorPersonId: null },
        { emailProvider: email.provider },
      );
      expect(sent.ok).toBe(true);
    }
    const over = await sendDepartureNote(
      db,
      { shopId: shop.id, tripId: trip.id, body: NOTE, actorPersonId: null },
      { emailProvider: email.provider },
    );
    expect(over).toEqual({ ok: false, reason: "limit" });
    expect(email.sent).toHaveLength(DEPARTURE_NOTES_PER_DEPARTURE);
  });

  it("holds the cap when sends race: exactly the cap is written and sent", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await book(db, shop.id, trip.id, { email: "note-race-a@example.com" });
    await book(db, shop.id, trip.id, { email: "note-race-b@example.com" });
    const email = fakeEmail();

    const outcomes = await Promise.all(
      Array.from({ length: DEPARTURE_NOTES_PER_DEPARTURE + 2 }, (_, i) =>
        sendDepartureNote(
          db,
          { shopId: shop.id, tripId: trip.id, body: `${NOTE} ${i}`, actorPersonId: null },
          { emailProvider: email.provider },
        ),
      ),
    );

    expect(outcomes.filter((o) => o.ok)).toHaveLength(DEPARTURE_NOTES_PER_DEPARTURE);
    expect(outcomes.filter((o) => !o.ok)).toEqual([
      { ok: false, reason: "limit" },
      { ok: false, reason: "limit" },
    ]);
    const rows = await db.select().from(departureNotes).where(eq(departureNotes.tripId, trip.id));
    expect(rows).toHaveLength(DEPARTURE_NOTES_PER_DEPARTURE);
    expect(email.sent).toHaveLength(DEPARTURE_NOTES_PER_DEPARTURE * 2);
  });

  it("counts notes still held against the cap at the hold", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    for (let i = 0; i < DEPARTURE_NOTES_PER_DEPARTURE; i += 1) {
      await holdSend(db, {
        shopId: shop.id,
        payload: { kind: "departure_note", tripId: trip.id, body: `${NOTE} ${i}` },
        actorPersonId: null,
      });
    }
    expect(
      await checkDepartureNote(db, {
        shopId: shop.id,
        tripId: trip.id,
        body: NOTE,
        countHeld: true,
      }),
    ).toEqual({ ok: false, reason: "limit" });
    // The send itself counts only what was sent.
    expect(
      (await checkDepartureNote(db, { shopId: shop.id, tripId: trip.id, body: NOTE })).ok,
    ).toBe(true);
  });

  it("cannot reach another shop's departure", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await book(db, shop.id, trip.id, { email: "note-cross@example.com" });
    const [other] = await db
      .insert(shops)
      .values({
        name: "Coral Ledge Divers",
        slug: "coral-ledge-notes",
        timezone: "America/New_York",
      })
      .returning({ id: shops.id });
    if (!other) throw new Error("second shop not inserted");
    const email = fakeEmail();

    const outcome = await sendDepartureNote(
      db,
      { shopId: other.id, tripId: trip.id, body: NOTE, actorPersonId: null },
      { emailProvider: email.provider },
    );
    expect(outcome).toEqual({ ok: false, reason: "not_found" });
    expect(email.sent).toEqual([]);
    expect(await departureNoteAudience(db, other.id, trip.id)).toBe(0);
  });

  it("counts only held seats as the audience", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    expect(await departureNoteAudience(db, shop.id, trip.id)).toBe(0);
    await book(db, shop.id, trip.id, { email: "note-aud@example.com" });
    expect(await departureNoteAudience(db, shop.id, trip.id)).toBe(1);
  });
});

describe("a held departure note", () => {
  it("is refused at release when the departure was cancelled during the hold", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await book(db, shop.id, trip.id, { email: "note-held@example.com" });
    const held = await holdSend(db, {
      shopId: shop.id,
      payload: { kind: "departure_note", tripId: trip.id, body: NOTE },
      actorPersonId: null,
    });
    await setTripStatus(db, shop.id, trip.id, "cancelled");

    const claim = await claimHeldSend(db, shop.id, held.id, undefined, { early: true });
    if (claim.status !== "claimed") throw new Error(`not claimed: ${claim.status}`);
    expect(await executeHeldSend(db, claim.row)).toEqual({
      kind: "departure_note",
      outcome: { ok: false, reason: "cancelled" },
    });
    const rows = await db.select().from(departureNotes).where(eq(departureNotes.tripId, trip.id));
    expect(rows).toEqual([]);
  });

  it("will not hold a note that carries a link", async () => {
    const { db, shop } = ctx;
    const trip = await departure(db, shop.id);
    await expect(
      holdSend(db, {
        shopId: shop.id,
        payload: { kind: "departure_note", tripId: trip.id, body: "see www.example" },
        actorPersonId: null,
      }),
    ).rejects.toThrow();
  });
});
