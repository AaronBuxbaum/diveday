import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import type { CourtesyProviders } from "@/lib/notifications/courtesy";
import { fileScopedShopContext } from "@/test/db";
import { mintCapability } from "./capabilities";
import { activityEvents, bookings, capabilities, people, waiverRecords } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { deliverWaiverBatch, issueAndDeliverPersonWaiver } from "./waiver-issue";
import { completeWaiver, doorNeedsDeskGuardian, waiverLinkDoor } from "./waivers-completion";
import { clearAnswers, openOnDevice, shopStaffer } from "./waivers-test-fixtures";

/**
 * **Copy link on a minor's release with no seat** (issue #4019). Signed, that
 * release covers every seat the diver holds, so the counter link Copy link
 * hands over asks the desk the question #3986 asks for a seat's counter QR:
 * is a parent or legal guardian here to co-sign? The answer goes on the
 * diver's trail, naming the very link, and the signature asks for it. A
 * minor's address the party's lead typed never gets a mailed release link.
 */
const ctx = fileScopedShopContext({ realShop: true });
const now = new Date("2026-07-18T12:00:00.000Z");

afterEach(() => vi.unstubAllEnvs());

async function diver(input: { dateOfBirth: string | null; email?: string }) {
  const [person] = await ctx.db
    .insert(people)
    .values({
      shopId: ctx.shop.id,
      fullName: `Mia Seatless ${crypto.randomUUID().slice(0, 6)}`,
      email: input.email ?? `mia.${crypto.randomUUID().slice(0, 6)}@dive.day`,
      phone: "+13055550188",
      dateOfBirth: input.dateOfBirth,
    })
    .returning();
  if (!person) throw new Error("person insert failed");
  return person;
}

/** Moves a seeded seat to `personId`, marked as the booker set it up. */
async function seatFor(personId: string, seat: { under18?: boolean; leadTyped?: boolean }) {
  const trips = await upcomingTripsWithCounts(ctx.db, ctx.shop.id, now);
  for (const trip of trips.filter((row) => row.status === "scheduled")) {
    const roster = await getTripRoster(ctx.db, ctx.shop.id, trip.id);
    const row = roster.find((entry) => entry.booking.status !== "cancelled");
    if (!row) continue;
    await ctx.db
      .update(bookings)
      .set({
        personId,
        minorDeclaredAt: seat.under18 ? now : null,
        contactTypedByLeadAt: seat.leadTyped ? now : null,
        claimedAt: null,
      })
      .where(eq(bookings.id, row.booking.id));
    return row.booking.id;
  }
  throw new Error("no seeded seat to move");
}

const guardian = { name: "Rosa Guardian", relationship: "parent", email: "", agreed: true };
const sign = (name: string, withGuardian = true) => ({
  signerName: name,
  agreed: true,
  medicalAnswers: clearAnswers,
  ...(withGuardian ? { guardian } : {}),
});

async function copyLink(personId: string, guardianPresent?: boolean) {
  return issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, personId, {
    channel: "link",
    actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
    guardianPresent,
    now,
  });
}

async function pendingRelease(personId: string) {
  const [record] = await ctx.db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.personId, personId),
        isNull(waiverRecords.bookingId),
        eq(waiverRecords.status, "pending"),
      ),
    )
    .limit(1);
  if (!record) throw new Error("pending release missing");
  return record;
}

async function trail(personId: string, code: string) {
  return ctx.db
    .select({ params: activityEvents.params })
    .from(activityEvents)
    .where(and(eq(activityEvents.subjectPersonId, personId), eq(activityEvents.code, code)));
}

describe("Copy link on a minor's release with no seat (#4019)", () => {
  it("asks whether a parent or guardian is at the counter, and mints nothing until the desk says so", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const minor = await diver({ dateOfBirth: "2012-03-04" });
    expect(await copyLink(minor.id)).toMatchObject({
      ok: true,
      delivery: "guardian_check",
      token: null,
    });
    expect(await trail(minor.id, "waiver_link_copied")).toEqual([]);
    const record = await pendingRelease(minor.id);
    expect(
      await ctx.db.select().from(capabilities).where(eq(capabilities.waiverRecordId, record.id)),
    ).toEqual([]);

    const confirmed = await copyLink(minor.id, true);
    if (!confirmed.ok || !confirmed.token) throw new Error("confirmed copy refused");
    const [link] = await ctx.db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(eq(capabilities.tokenHash, hashBearerToken(confirmed.token)));
    // The desk's word is on the minor's trail, naming this release and this link.
    expect(await trail(minor.id, "waiver_counter_guardian_confirmed")).toEqual([
      { params: expect.objectContaining({ record: record.id, link: link?.id }) },
    ]);
    const door = await openOnDevice(ctx.db, confirmed.token, now);
    if (door?.door !== "counter") throw new Error("counter door expected");
    expect(await doorNeedsDeskGuardian(ctx.db, door.key, now)).toBe(false);
    expect(await completeWaiver(ctx.db, door.key, { ...sign(minor.fullName), now })).toMatchObject({
      ok: true,
    });
  });

  it("reads Under 18 on any live seat when no date of birth is on file", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const minor = await diver({ dateOfBirth: null });
    await seatFor(minor.id, { under18: true });
    expect(await copyLink(minor.id)).toMatchObject({ ok: true, delivery: "guardian_check" });
  });

  it("reads nothing from an Under 18 on a seat whose trip is back (#2553)", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const grown = await diver({ dateOfBirth: null });
    await seatFor(grown.id, { under18: true });
    const years = new Date("2031-01-01T12:00:00.000Z");
    expect(
      await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, grown.id, {
        channel: "link",
        actorPersonId: await shopStaffer(ctx.db, ctx.shop.id),
        now: years,
      }),
    ).toMatchObject({ ok: true, delivery: "link_only" });
  });

  it("asks an adult nothing", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const adult = await diver({ dateOfBirth: "1990-03-04" });
    const copied = await copyLink(adult.id);
    expect(copied).toMatchObject({ ok: true, delivery: "link_only" });
    expect(await trail(adult.id, "waiver_counter_guardian_confirmed")).toEqual([]);
  });

  it("refuses a minor's signature on a counter link the desk never vouched for", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const minor = await diver({ dateOfBirth: "2012-03-04" });
    // A release opened by a text, then a counter link minted around the desk.
    const { providers } = textCapture();
    await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, minor.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    const record = await pendingRelease(minor.id);
    const forged = await mintCapability(ctx.db, {
      purpose: "waiver_link",
      shopId: ctx.shop.id,
      subjectId: record.id,
      now,
    });
    const door = await openOnDevice(ctx.db, forged.token, now);
    if (door?.door !== "counter") throw new Error("counter door expected");
    expect(await doorNeedsDeskGuardian(ctx.db, door.key, now)).toBe(true);
    expect(await completeWaiver(ctx.db, door.key, { ...sign(minor.fullName), now })).toEqual({
      ok: false,
      reason: "guardian_at_counter",
    });
  });

  it("carries the desk's answer through a batch, as the diver record's Copy link sends it", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const minor = await diver({ dateOfBirth: "2012-03-04" });
    const actorPersonId = await shopStaffer(ctx.db, ctx.shop.id);
    const asked = await deliverWaiverBatch(ctx.db, ctx.shop.id, {
      bookingIds: [],
      personId: minor.id,
      channel: "link",
      actorPersonId,
    });
    expect(asked.links).toEqual([
      expect.objectContaining({ name: minor.fullName, token: null, reason: "guardian_check" }),
    ]);
    const confirmed = await deliverWaiverBatch(ctx.db, ctx.shop.id, {
      bookingIds: [],
      personId: minor.id,
      channel: "link",
      actorPersonId,
      guardianPresent: true,
    });
    expect(confirmed.links).toEqual([
      expect.objectContaining({ token: expect.any(String), reason: "link_only" }),
    ]);
  });
});

describe("a mailed release link to a minor's address the lead typed (#4019)", () => {
  it("sends nothing, as a seat's send to that address does not", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const minor = await diver({ dateOfBirth: null });
    await seatFor(minor.id, { under18: true, leadTyped: true });
    const { providers, bodies } = textCapture();
    const texted = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, minor.id, {
      channel: "sms",
      textProviders: providers,
      now,
    });
    expect(texted).toMatchObject({ ok: true, delivery: "guardian_needed", token: null });
    expect(bodies).toEqual([]);
    const emailed = await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, minor.id, {
      channel: "email",
      now,
    });
    expect(emailed).toMatchObject({ ok: true, delivery: "guardian_needed", token: null });
    const record = await pendingRelease(minor.id);
    expect(
      await ctx.db.select().from(capabilities).where(eq(capabilities.waiverRecordId, record.id)),
    ).toEqual([]);
  });

  it("still sends nothing once that seat is cancelled: the typed contact stays on file", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const minor = await diver({ dateOfBirth: "2012-03-04" });
    const seat = await seatFor(minor.id, { leadTyped: true });
    await ctx.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, seat));
    const { providers } = textCapture();
    expect(
      await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, minor.id, {
        channel: "sms",
        textProviders: providers,
        now,
      }),
    ).toMatchObject({ ok: true, delivery: "guardian_needed" });
  });

  it("refuses the signature on a link sent before the diver read as a minor", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const diverNow = await diver({ dateOfBirth: null });
    await seatFor(diverNow.id, { leadTyped: true });
    const { providers, bodies } = textCapture();
    expect(
      await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, diverNow.id, {
        channel: "sms",
        textProviders: providers,
        now,
      }),
    ).toMatchObject({ ok: true, delivery: "sent" });
    const token = bodies[0]?.match(/\/waivers\/([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error("no link texted");
    await ctx.db
      .update(people)
      .set({ dateOfBirth: "2012-03-04" })
      .where(eq(people.id, diverNow.id));
    const door = await waiverLinkDoor(ctx.db, token, { now });
    if (door?.door !== "release") throw new Error("release door expected");
    expect(await doorNeedsDeskGuardian(ctx.db, door.key, now)).toBe(true);
    expect(await completeWaiver(ctx.db, door.key, { ...sign(diverNow.fullName), now })).toEqual({
      ok: false,
      reason: "guardian_at_counter",
    });
  });

  it("still mails an adult whose address the lead typed, and a minor whose own address it is", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const adult = await diver({ dateOfBirth: "1990-03-04" });
    await seatFor(adult.id, { leadTyped: true });
    const { providers } = textCapture();
    expect(
      await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, adult.id, {
        channel: "sms",
        textProviders: providers,
        now,
      }),
    ).toMatchObject({ ok: true, delivery: "sent" });
    const minor = await diver({ dateOfBirth: "2012-03-04" });
    expect(
      await issueAndDeliverPersonWaiver(ctx.db, ctx.shop.id, minor.id, {
        channel: "sms",
        textProviders: providers,
        now,
      }),
    ).toMatchObject({ ok: true, delivery: "sent" });
  });
});

function textCapture() {
  const bodies: string[] = [];
  const providers: CourtesyProviders = {
    whatsapp: null,
    sms: {
      send: vi.fn(async (message: { body: string }) => {
        bodies.push(message.body);
        return { status: "sent" as const, providerMessageId: `sms-${bodies.length}` };
      }),
    } as unknown as CourtesyProviders["sms"],
  };
  return { providers, bodies };
}
