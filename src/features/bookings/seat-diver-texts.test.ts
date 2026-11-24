// @vitest-environment node
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "../../db/client";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";

const { sesSend } = vi.hoisted(() => ({ sesSend: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...actual,
    SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
      return { send: sesSend };
    }),
  };
});

/**
 * The platform SMS sender, faked at its one constructor: `null` is no SMS set
 * up (the environment's default), otherwise every text lands in `sent`, and
 * `fail` makes the provider refuse or throw.
 */
const sms = vi.hoisted(() => ({
  on: false,
  sent: [] as { to: string; body: string }[],
  fail: null as null | "refuse" | "throw",
}));
vi.mock("@/lib/notifications/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/sms")>();
  return {
    ...actual,
    smsProviderFromEnvironment: () =>
      sms.on
        ? {
            configured: true,
            async send(message: { to: string; body: string }) {
              if (sms.fail === "throw") throw new Error("sns down");
              sms.sent.push(message);
              return sms.fail === "refuse"
                ? ({ status: "failed", errorCode: "provider_error" } as const)
                : ({ status: "sent", providerMessageId: `SM_${sms.sent.length}` } as const);
            },
          }
        : actual.smsProviderFromEnvironment({}),
  };
});

import {
  notificationDeliveries,
  people,
  personRoles,
  smsOptOuts,
  trips as tripsTable,
  waiverDeliveries,
  waiverRecords,
} from "../../db/schema/index";
import { upcomingTripsWithCounts } from "../../db/trips-queries.test-support";
import { seatDiver, seatParty } from "./seat-diver";

/** The seeded open departure `seat-diver.test.ts` works against, and a staff actor. */
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
  return { db, shop, open, actorPersonId: staff.id };
}

const DELIVERABLE_EMAIL = "delivered@dive.day";

/** Stub a shop whose email can actually go out, and capture the send. */
function deliverableEmailEnv() {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockReset().mockResolvedValue({ MessageId: "ses-id" });
  return sesSend;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`). A demo shop sends nothing.
const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sms.on = false;
  sms.sent.length = 0;
  sms.fail = null;
});

/**
 * **The ready link goes by text too** ("Try it Saturday", item 3). A diver a
 * shop seats with a phone gets their readiness link (the waiver, the cert card
 * and the sizes are all on it) by text, beside the email when they have one;
 * a phone-only diver is no longer `not_sent`. Failure paths: no SMS set up, a
 * provider refusal or throw, a number that sent STOP, a rehearsal. Each keeps
 * the seat and says honestly that nothing reached the diver.
 */
describe("seatDiver texts the ready link (Try it Saturday, item 3)", () => {
  const PHONE = "+1 305 555 0142";
  const READY_LINK = /https:\/\/diveday\.example\/ready\/[A-Za-z0-9._-]+/;

  async function confirmationRows(db: AppDb, bookingId: string) {
    return db
      .select({ status: notificationDeliveries.status, kind: notificationDeliveries.kind })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
  }

  async function waiverChannels(db: AppDb, bookingId: string) {
    const rows = await db
      .select({ channel: waiverDeliveries.channel })
      .from(waiverDeliveries)
      .innerJoin(waiverRecords, eq(waiverRecords.id, waiverDeliveries.waiverRecordId))
      .where(eq(waiverRecords.bookingId, bookingId));
    return rows.map((row) => row.channel);
  }

  it("texts a phone-only diver their ready link, and that is their confirmation", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const send = deliverableEmailEnv();
    sms.on = true;

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Phone Only Paloma", phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({
      ok: true,
      confirmation: "sent",
      reached: ["sms"],
      waiver: "sent",
    });
    if (!result.ok) throw new Error("expected the diver to be seated");
    // Nothing to hand over at the desk: the link went to their phone.
    expect(result.waiverPath).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(sms.sent).toHaveLength(1);
    const [text] = sms.sent;
    expect(text?.to).toBe("+13055550142");
    expect(text?.body).toMatch(READY_LINK);
    expect(text?.body).toContain(shop.name);
    expect(text?.body).toMatch(/Reply STOP to opt out\.$/);
    // The text is the confirmation a phone-only diver gets, recorded as one.
    expect(await confirmationRows(db, result.bookingId)).toEqual([
      { kind: "booking_confirmation", status: "sent" },
    ]);
    // The Sign step rode in the text's ready link, and the record says so.
    expect(await waiverChannels(db, result.bookingId)).toEqual(["sms"]);
  });

  /**
   * One segment is out of reach: the ready link alone is ~100 characters and
   * the STOP line 24, which leaves ~35 for the shop's name and the day. So the
   * text stays GSM-7 (a single "’" or no-break space would make it UCS-2, 67
   * characters a segment, four segments) and inside two concatenated
   * segments (2 × 153).
   */
  it("keeps the text GSM-7 and inside two SMS segments", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    sms.on = true;

    await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Segment Sam", phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    const body = sms.sent[0]?.body ?? "";
    // Printable ASCII without GSM-7's escaped characters: one septet each.
    expect(body).toMatch(/^[ -Z_a-z!"#$%&'()*+,\-./:;<=>?@]*$/);
    expect(body.length).toBeLessThanOrEqual(2 * 153);
  });

  it("emails and texts a diver who has both, with the same ready link", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const send = deliverableEmailEnv();
    sms.on = true;

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Both Ways Bea", email: DELIVERABLE_EMAIL, phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({
      ok: true,
      confirmation: "sent",
      reached: ["email", "sms"],
      waiver: "sent",
    });
    if (!result.ok) throw new Error("expected the diver to be seated");
    expect(send).toHaveBeenCalledOnce();
    expect(sms.sent).toHaveLength(1);
    const texted = sms.sent[0]?.body.match(READY_LINK)?.[0];
    expect(texted).toBeDefined();
    expect(JSON.stringify(send.mock.calls[0]?.[0])).toContain(texted);
    // One confirmation row: the email's. The text rides beside it.
    expect(await confirmationRows(db, result.bookingId)).toEqual([
      { kind: "booking_confirmation", status: "sent" },
    ]);
    expect(await waiverChannels(db, result.bookingId)).toEqual(["email"]);
  });

  it("still texts when the email fails, and says only the text reached them", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const send = deliverableEmailEnv();
    send
      .mockReset()
      .mockRejectedValue(Object.assign(new Error("ses down"), { name: "Throttling" }));
    sms.on = true;

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Mail Down Max", email: DELIVERABLE_EMAIL, phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({
      ok: true,
      confirmation: "sent",
      reached: ["sms"],
      waiver: "sent",
    });
    expect(sms.sent).toHaveLength(1);
  });

  it("says not_sent, keeps the seat and hands over nothing false when no SMS is set up", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "No Sms Nia", phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({
      ok: true,
      confirmation: "not_sent",
      reached: [],
      waiver: "not_delivered",
    });
    if (!result.ok) throw new Error("expected the diver to be seated");
    // No failed row: Today would offer a resend with no email to resend to.
    expect(await confirmationRows(db, result.bookingId)).toEqual([]);
  });

  it("says not_sent when the provider refuses, and sends no second text", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    sms.on = true;
    sms.fail = "refuse";

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Refused Rui", phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, confirmation: "not_sent", reached: [] });
    expect(sms.sent).toHaveLength(1);
    if (!result.ok) throw new Error("expected the diver to be seated");
    expect(await confirmationRows(db, result.bookingId)).toEqual([]);
  });

  it("keeps the seat and the email when the text throws", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const send = deliverableEmailEnv();
    sms.on = true;
    sms.fail = "throw";

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Throwing Theo", email: DELIVERABLE_EMAIL, phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({
      ok: true,
      confirmation: "sent",
      reached: ["email"],
      waiver: "sent",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("never texts a number that sent STOP", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    sms.on = true;
    await db
      .insert(smsOptOuts)
      .values({ phone: "+13055550142", optedOut: true, keywordAt: nowDate() });

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Stopped Stella", phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, confirmation: "not_sent", reached: [] });
    expect(sms.sent).toEqual([]);
  });

  it("texts nobody about a rehearsal departure", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    sms.on = true;
    await db
      .update(tripsTable)
      .set({ isRehearsal: true, isPrivate: true })
      .where(eq(tripsTable.id, open.id));

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Practice Pat", phone: PHONE },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, reached: [] });
    expect(sms.sent).toEqual([]);
  });

  it("reaches each party member on their own contact, and says so per seat", async () => {
    const { db, shop, open, actorPersonId } = await context();
    const send = deliverableEmailEnv();
    sms.on = true;

    const result = await seatParty(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      entry: "roster",
      refusals: "specific",
      members: [
        { fullName: "Lead Lena", email: DELIVERABLE_EMAIL, minor: false },
        { fullName: "Texted Tom", phone: PHONE, minor: false },
        { fullName: "Name Only Nora", minor: false },
      ],
    });

    if (!result.ok) throw new Error("expected the party to be seated");
    expect(result.seats.map((seat) => [seat.personName, seat.confirmation, seat.reached])).toEqual([
      ["Lead Lena", "sent", ["email"]],
      ["Texted Tom", "sent", ["sms"]],
      ["Name Only Nora", "not_sent", []],
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(sms.sent.map((text) => text.to)).toEqual(["+13055550142"]);
  });

  it("texts a number it cannot dial internationally to nobody", async () => {
    const { db, shop, open, actorPersonId } = await context();
    deliverableEmailEnv();
    sms.on = true;

    const result = await seatDiver(db, {
      shopId: shop.id,
      tripId: open.id,
      actorPersonId,
      diver: { fullName: "Local Lou", phone: "555-0142" },
      entry: "roster",
      refusals: "specific",
    });

    expect(result).toMatchObject({ ok: true, confirmation: "not_sent", reached: [] });
    expect(sms.sent).toEqual([]);
  });
});
