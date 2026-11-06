import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { issueBookingCapability } from "./booking-capabilities";
import { createBookingParty } from "./bookings";
import { sendFindMyBookingLinks } from "./find-my-booking";
import { sendDueReminders } from "./reminders";
import { bookingCapabilities, bookings, people } from "./schema";
import { moveSeat } from "./seat-diver";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { issueAndDeliverWaiver, resendConfirmationWithWaiver } from "./waiver-issue";

/**
 * **An adult party member gets the links any booker gets** (ux-over-hardening,
 * 2026-11-06): the address the lead typed is trusted, so staff Send waivers, a
 * re-sent confirmation, the reminders and find-my-booking all carry the seat's
 * own readiness link. **A seat declared Under 18 whose address the lead typed
 * gets none** (issue #4003): that inbox cannot prove a guardian, so the lead
 * signs the release on their own link, or the desk does with a guardian there.
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

const DOOR = /\/waivers\//;
const SIGN_STEP = /\/ready\/[\w.-]+\/waiver/;

/** A lead and one member, booked together on the public party form. */
async function publicParty(options: { minor?: boolean } = {}) {
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
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Theo Marsh",
      email: MEMBER,
      minorDeclared: options.minor,
    },
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

describe("an adult party member gets the links any booker gets", () => {
  it("is stamped as no lead-typed address, so a delivered readiness link mints", async () => {
    const { db, shop, member } = await publicParty();
    const [seat] = await db
      .select({ typed: bookings.contactTypedByLeadAt })
      .from(bookings)
      .where(eq(bookings.id, member.bookingId));
    expect(seat?.typed).toBeNull();
    expect(
      await issueBookingCapability(db, {
        shopId: shop.id,
        bookingId: member.bookingId,
        purpose: "readiness",
        delivered: true,
      }),
    ).not.toBeNull();
  });

  it("staff Send waivers emails the member their own thread link", async () => {
    configureMail();
    const { db, shop, member } = await publicParty();

    const result = await issueAndDeliverWaiver(db, shop.id, member.bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "sent", token: null });
    const [body = ""] = mailTo(MEMBER);
    expect(body).toMatch(SIGN_STEP);
    expect(body).not.toMatch(DOOR);
    expect(await deliveredReadiness(member.bookingId)).toHaveLength(1);
  });

  it("texts the same thread link", async () => {
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
    expect(text).toMatch(SIGN_STEP);
    expect(text).not.toMatch(DOOR);
  });

  it("re-sends the member's confirmation with their readiness link", async () => {
    configureMail();
    const { db, shop, member } = await publicParty();

    await resendConfirmationWithWaiver(db, shop.id, member.bookingId);

    const mail = mailTo(MEMBER);
    expect(mail.some((body) => body.includes("/ready/"))).toBe(true);
    for (const body of mail) expect(body).not.toMatch(DOOR);
    expect(await deliveredReadiness(member.bookingId)).toHaveLength(1);
  });

  it("find-my-booking sends the member's address their readiness link", async () => {
    configureMail();
    const { db, shop, member } = await publicParty();

    await sendFindMyBookingLinks(db, { shopId: shop.id, email: MEMBER, origin: ORIGIN });

    const [body = ""] = mailTo(MEMBER);
    expect(body).toContain("/ready/");
    expect(await deliveredReadiness(member.bookingId)).toHaveLength(1);
  });

  it("reminds the member with their readiness link", async () => {
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
    expect(reminders[0]).toHaveProperty("readinessUrl", expect.any(String));
  });
});

describe("a minor member's address the lead typed gets no link (issue 4003)", () => {
  it("refuses to mint a delivered readiness link for the seat until the member claims it", async () => {
    const { db, shop, member } = await publicParty({ minor: true });
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

  it("keeps the address linkless after staff move the seat out of its party", async () => {
    vi.stubEnv("APP_HOST", ORIGIN);
    const { db, shop, trip, member } = await publicParty({ minor: true });
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
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });

  it("sends nothing on Send waivers: the address cannot prove a guardian", async () => {
    configureMail();
    const { db, shop, member } = await publicParty({ minor: true });

    const result = await issueAndDeliverWaiver(db, shop.id, member.bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "guardian_needed", token: null });
    expect(mailTo(MEMBER)).toEqual([]);
  });

  it("find-my-booking sends the address nothing", async () => {
    configureMail();
    const { db, shop, member } = await publicParty({ minor: true });

    await sendFindMyBookingLinks(db, { shopId: shop.id, email: MEMBER, origin: ORIGIN });

    expect(mailTo(MEMBER)).toEqual([]);
    expect(await deliveredReadiness(member.bookingId)).toEqual([]);
  });

  it("still reminds the member, with no readiness link in the mail", async () => {
    const { db, trip, member } = await publicParty({ minor: true });
    const email = fakeEmail();
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
