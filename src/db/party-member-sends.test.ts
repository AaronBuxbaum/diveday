import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { createBookingParty } from "./bookings";
import { verifyCapability } from "./capabilities";
import { sendFindMyBookingLinks } from "./find-my-booking";
import { sendDueReminders } from "./reminders";
import { bookingCapabilities, bookings, capabilities, people } from "./schema";
import { moveSeat } from "./seat-diver";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import {
  emailFreshWaiverLink,
  issueAndDeliverWaiver,
  issueWaiverOnJoin,
  resendConfirmationWithWaiver,
} from "./waiver-issue";
import { staleWaiverRecordForToken } from "./waivers";
import { completeWaiver, doorNeedsDeskGuardian } from "./waivers-completion";
import { clearAnswers, openOnDevice } from "./waivers-test-fixtures";

/**
 * **A party member's address gets the waiver-only door, by every road**
 * (issue #4003). The public party form's lead typed the member's address, so
 * no later send to it carries the seat's readiness link, which pays, cancels
 * and moves the seat: staff Send waivers, a re-sent confirmation, the
 * reminders, find-my-booking. A dead door has a rescue that mails a fresh door
 * to the address on file.
 */

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

const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

const ORIGIN = "https://diveday.example";
const MEMBER = "member.4003@dive.day";

function configureMail() {
  vi.stubEnv("APP_HOST", ORIGIN);
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockResolvedValue({ MessageId: "ses-4003" });
}

/** Every mail to `to` so far, as text. */
function mailTo(to: string): string[] {
  return sesSend.mock.calls.flatMap(([command]) => {
    const input = (command as SendEmailCommand).input;
    if (input.Destination?.ToAddresses?.[0] !== to) return [];
    const content = input.Content?.Simple?.Body;
    return [`${content?.Text?.Data ?? ""}${content?.Html?.Data ?? ""}`];
  });
}

const DOOR = /\/waivers\/([A-Za-z0-9_-]+)/;

/** A lead and one member, booked together on the public party form. */
async function publicParty() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Nora Quinn",
      email: "nora.4003@dive.day",
    },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Theo Marsh", email: MEMBER },
  ]);
  if (!party.ok) throw new Error(`party failed: ${party.reason}`);
  const [lead, member] = party.bookings;
  if (!lead || !member) throw new Error("party seats missing");
  return { db, shop, trip, lead, member };
}

async function deliveredReadiness(bookingId: string) {
  return ctx.db
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.bookingId, bookingId),
        eq(bookingCapabilities.purpose, "readiness"),
        eq(bookingCapabilities.delivered, true),
      ),
    );
}

describe("a party member's address never gets a readiness link (issue 4003)", () => {
  it("refuses to mint a delivered readiness link for the seat until the member claims it", async () => {
    const { db, shop, member } = await publicParty();
    const ask = { shopId: shop.id, bookingId: member.bookingId, purpose: "readiness" as const };
    expect(await issueBookingCapability(db, { ...ask, delivered: true })).toBeNull();
    // The lead's party panel hands over an undelivered one: the lead's own.
    expect(await issueBookingCapability(db, ask)).not.toBeNull();
    await db
      .update(bookings)
      .set({ claimedAt: nowDate() })
      .where(eq(bookings.id, member.bookingId));
    expect(await issueBookingCapability(db, { ...ask, delivered: true })).not.toBeNull();
  });

  it("keeps the address waiver-only after staff move the seat out of its party", async () => {
    vi.stubEnv("APP_HOST", ORIGIN);
    const { db, shop, trip, member } = await publicParty();
    const other = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id !== trip.id);
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!other || !owner) throw new Error("second trip or owner missing");
    const email = fakeEmail();

    const moved = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: trip.id,
        toTripId: other.id,
        bookingId: member.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: email.provider, appOrigin: ORIGIN },
    );

    expect(moved.ok).toBe(true);
    for (const sent of email.sent)
      expect(sent).not.toHaveProperty("readinessUrl", expect.any(String));
    expect(
      await issueBookingCapability(db, {
        shopId: shop.id,
        bookingId: member.bookingId,
        purpose: "readiness",
        delivered: true,
      }),
    ).toBeNull();
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });

  it("staff Send waivers emails the member a waiver-only door", async () => {
    configureMail();
    const { db, shop, member } = await publicParty();

    const result = await issueAndDeliverWaiver(db, shop.id, member.bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "sent", token: null });
    const [body = ""] = mailTo(MEMBER);
    expect(body).not.toContain("/ready/");
    const token = body.match(DOOR)?.[1];
    if (!token) throw new Error("no door in the mail");
    expect(await verifyCapability(db, { purpose: "party_waiver_link", token })).toMatchObject({
      shopId: shop.id,
    });
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });

  it("texts the same door, never a readiness link", async () => {
    vi.stubEnv("APP_HOST", ORIGIN);
    const { db, shop, member } = await publicParty();
    await db.update(people).set({ phone: "+13055550143" }).where(eq(people.id, member.personId));
    const sms = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "sns" }) };

    const result = await issueAndDeliverWaiver(db, shop.id, member.bookingId, {
      channel: "sms",
      textProviders: { whatsapp: null, sms },
    });

    expect(result).toMatchObject({ ok: true, delivery: "sent" });
    const text: string = sms.send.mock.calls[0]?.[0]?.body ?? "";
    expect(text).not.toContain("/ready/");
    expect(text).toMatch(DOOR);
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });

  it("sends a minor member nothing: the address cannot prove a guardian", async () => {
    configureMail();
    const { db, shop, member } = await publicParty();
    await db
      .update(bookings)
      .set({ minorDeclaredAt: nowDate() })
      .where(eq(bookings.id, member.bookingId));

    const result = await issueAndDeliverWaiver(db, shop.id, member.bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "guardian_needed", token: null });
    expect(mailTo(MEMBER)).toEqual([]);
    expect(
      await db
        .select({ id: capabilities.id })
        .from(capabilities)
        .where(eq(capabilities.purpose, "party_waiver_link")),
    ).toEqual([]);
  });

  it("re-sends the member's confirmation with no readiness link, and the release as a door", async () => {
    configureMail();
    const { db, shop, member } = await publicParty();

    await resendConfirmationWithWaiver(db, shop.id, member.bookingId);

    const mail = mailTo(MEMBER);
    expect(mail.length).toBeGreaterThan(0);
    for (const body of mail) expect(body).not.toContain("/ready/");
    expect(mail.some((body) => DOOR.test(body))).toBe(true);
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });

  it("find-my-booking sends the member's address only a door, and only when theirs has died", async () => {
    configureMail();
    const { db, shop, member } = await publicParty();
    const find = (now?: Date) =>
      sendFindMyBookingLinks(db, { shopId: shop.id, email: MEMBER, origin: ORIGIN, now });

    // No release waiting: nothing at all.
    await find();
    expect(mailTo(MEMBER)).toEqual([]);
    // The join mail's door still stands: nothing either.
    await issueWaiverOnJoin(db, shop.id, member.bookingId);
    sesSend.mockClear();
    await find();
    expect(mailTo(MEMBER)).toEqual([]);
    // Once it has died, a fresh door, and never a readiness link.
    await db
      .update(capabilities)
      .set({ revokedAt: nowDate() })
      .where(eq(capabilities.purpose, "party_waiver_link"));
    await find();
    const [body = ""] = mailTo(MEMBER);
    expect(body).toMatch(DOOR);
    expect(body).not.toContain("/ready/");
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });

  it("still reminds the member, with no readiness link in the mail", async () => {
    const { db, trip, member } = await publicParty();
    const email = fakeEmail();
    // 100h out lands in the 7-day bucket.
    const now = new Date(trip.startsAt.getTime() - 100 * 60 * 60 * 1000);

    await sendDueReminders(db, {
      now,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });

    const reminders = email.sent.filter(
      (sent) => "bookingId" in sent && sent.bookingId === member.bookingId,
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).not.toHaveProperty("readinessUrl", expect.any(String));
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });
});

describe("a dead party door's rescue (issue 4003)", () => {
  async function doorToken() {
    configureMail();
    const party = await publicParty();
    await issueWaiverOnJoin(party.db, party.shop.id, party.member.bookingId);
    const token = mailTo(MEMBER)[0]?.match(DOOR)?.[1];
    if (!token) throw new Error("no door mailed");
    sesSend.mockClear();
    return { ...party, token };
  }

  it("resolves only a dead door, and mails a fresh door to the address on file", async () => {
    const { db, token } = await doorToken();
    expect(await staleWaiverRecordForToken(db, token)).toBeNull();
    const later = new Date(nowDate().getTime() + 15 * DAY_MS);
    expect(await staleWaiverRecordForToken(db, token, later)).not.toBeNull();

    expect(await emailFreshWaiverLink(db, token, later)).toBe("sent");

    const [body = ""] = mailTo(MEMBER);
    expect(body).not.toContain("/ready/");
    const fresh = body.match(DOOR)?.[1];
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(token);
  });

  it("issues nothing while a newer door still stands", async () => {
    const { db, shop, member, token } = await doorToken();
    await issueAndDeliverWaiver(db, shop.id, member.bookingId);
    sesSend.mockClear();

    expect(await emailFreshWaiverLink(db, token)).toBe("current_link_live");
    expect(mailTo(MEMBER)).toEqual([]);
  });

  it("signs no minor's release through a door: a guardian is asked for at the counter", async () => {
    const { db, member, token } = await doorToken();
    await db
      .update(bookings)
      .set({ minorDeclaredAt: nowDate() })
      .where(eq(bookings.id, member.bookingId));
    const door = await openOnDevice(db, token);
    if (door?.door !== "counter") throw new Error("the door does not open");
    // The page says so before the form (`doorNeedsDeskGuardian`), and Sign refuses.
    expect(await doorNeedsDeskGuardian(db, door.key)).toBe(true);
    expect(
      await completeWaiver(db, door.key, {
        signerName: "Theo Marsh",
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { name: "Rosa Marsh", relationship: "parent", email: "", agreed: true },
      }),
    ).toEqual({ ok: false, reason: "guardian_at_counter" });
  });

  it("never turns a dead door into a readiness link", async () => {
    const { db, member, token } = await doorToken();
    const later = new Date(nowDate().getTime() + 15 * DAY_MS);
    await emailFreshWaiverLink(db, token, later);
    expect(await verifyBookingCapability(db, { token, purpose: "readiness" })).toBeNull();
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });
});
