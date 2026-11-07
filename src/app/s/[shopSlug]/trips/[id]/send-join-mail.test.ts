import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasLiveDeliveredReadinessLink, verifyBookingCapability } from "@/db/booking-capabilities";
import { createBooking, getBookingForTrip } from "@/db/bookings";
import { bookings, waiverRecords } from "@/db/schema";
import { getTripWithBooked, upcomingTripsWithCounts } from "@/db/trips";
import { threadWaiverKey } from "@/db/waivers";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { sendJoinMail } from "./send-join-mail";

/**
 * **One booking, one email, one link** (issue #2743). The booker's own release
 * rides in the confirmation as the thread's Sign step, on the readiness link
 * that same mail carries: the diver is never handed a waiver link for their
 * own seat, and the Sign step opens only the booker's seat.
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

// A demo shop sends no mail; these tests are about mail.
const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

function configureMail() {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockResolvedValue({ MessageId: "ses-join" });
}

/** Every mail sent so far: recipient and body. */
function sentMail(): { to: string; body: string }[] {
  return sesSend.mock.calls.map(([command]) => {
    const input = (command as SendEmailCommand).input;
    const content = input.Content?.Simple?.Body;
    return {
      to: input.Destination?.ToAddresses?.[0] ?? "",
      body: `${content?.Text?.Data ?? ""}${content?.Html?.Data ?? ""}`,
    };
  });
}

const SIGN_STEP = /\/ready\/([A-Za-z0-9._-]+)\/waiver/;

async function seat(tripId: string, fullName: string, email: string) {
  const { db, shop } = ctx;
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId,
    fullName,
    email,
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, outcome.bookingId));
  if (!row) throw new Error("booking missing");
  return { bookingId: outcome.bookingId, personId: row.personId };
}

async function joinMail(seats: { bookingId: string; personId: string }[], tripId: string) {
  const { db, shop } = ctx;
  const [lead, ...members] = seats;
  if (!lead) throw new Error("no lead");
  // Each other seat is one the public party form made for the lead, unclaimed.
  for (const member of members) {
    await db
      .update(bookings)
      .set({ partyLeadBookingId: lead.bookingId })
      .where(eq(bookings.id, member.bookingId));
  }
  await sendJoinMail(db, {
    shop,
    trip: await getTripWithBooked(db, shop.id, tripId),
    lead: await getBookingForTrip(db, shop.id, tripId, lead.bookingId),
    primaryBookingId: lead.bookingId,
    bookings: seats,
    ownLocale: null,
    money: { chargesOnline: false, partyTypes: [] },
  });
}

async function upcomingTripId() {
  const [trip] = await upcomingTripsWithCounts(ctx.db, ctx.shop.id);
  if (!trip) throw new Error("demo trip missing");
  return trip.id;
}

describe("sendJoinMail", () => {
  it("carries the booker's release as the Sign step on the confirmation's own readiness link", async () => {
    configureMail();
    const { db, shop } = ctx;
    const tripId = await upcomingTripId();
    const lead = await seat(tripId, "Nora Quinn", "nora@dive.day");

    await joinMail([lead], tripId);

    const mail = sentMail();
    expect(mail).toHaveLength(1);
    const body = mail[0]?.body ?? "";
    expect(body).not.toContain("/waivers/");
    const token = body.match(SIGN_STEP)?.[1];
    if (!token) throw new Error("no Sign step in the confirmation");
    // The Sign step is the readiness link the mail already carries, and that
    // link opens the booker's own seat.
    expect(body).toContain(`https://diveday.example/ready/${token}\n`);
    expect(await verifyBookingCapability(db, { token, purpose: "readiness" })).toMatchObject({
      shopId: shop.id,
      bookingId: lead.bookingId,
    });
    // The release is open on that seat, recorded as emailed, and the thread
    // reaches exactly it.
    const records = await db
      .select({ id: waiverRecords.id, deliveryStatus: waiverRecords.deliveryStatus })
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, lead.bookingId));
    expect(records).toHaveLength(1);
    expect(records[0]?.deliveryStatus).toBe("sent");
    const key = await threadWaiverKey(db, { shopId: shop.id, bookingId: lead.bookingId });
    expect(key?.recordId).toBe(records[0]?.id);
  });

  it("sends an adult party member the links any booker gets, on their own seat", async () => {
    configureMail();
    const { db, shop } = ctx;
    const tripId = await upcomingTripId();
    const lead = await seat(tripId, "Nora Quinn", "nora@dive.day");
    // The address the lead typed for the friend.
    const friend = await seat(tripId, "Theo Marsh", "theo@dive.day");

    await joinMail([lead, friend], tripId);

    const mail = sentMail();
    const toLead = mail.filter((sent) => sent.to === "nora@dive.day");
    const toFriend = mail.filter((sent) => sent.to === "theo@dive.day");
    expect(toLead).toHaveLength(1);
    expect(toFriend.length).toBeGreaterThan(0);
    const leadToken = toLead[0]?.body.match(SIGN_STEP)?.[1];
    if (!leadToken) throw new Error("no Sign step in the confirmation");
    const capability = await verifyBookingCapability(db, {
      token: leadToken,
      purpose: "readiness",
    });
    expect(capability?.bookingId).toBe(lead.bookingId);
    // The friend's mail carries their own seat's readiness link.
    for (const sent of toFriend) expect(sent.body).not.toContain("/waivers/");
    const friendToken = toFriend.map((sent) => sent.body.match(SIGN_STEP)?.[1]).find(Boolean);
    if (!friendToken) throw new Error("no readiness link to the friend");
    expect(
      await verifyBookingCapability(db, { token: friendToken, purpose: "readiness" }),
    ).toMatchObject({ shopId: shop.id, bookingId: friend.bookingId });
    expect(
      await hasLiveDeliveredReadinessLink(db, { shopId: shop.id, bookingId: friend.bookingId }),
    ).toBe(true);
  });

  /**
   * **A shared inbox's other diver hears at the inbox that booked them**
   * (Aaron 2026-11-06). Their record holds no email, since the address is
   * Nora's; the seat keeps the address they typed, and its mail goes there.
   */
  it("mails a shared-inbox booker's confirmation and Sign step to the address they typed", async () => {
    configureMail();
    const { db, shop } = ctx;
    const tripId = await upcomingTripId();
    await seat(tripId, "Nora Quinn", "nora@dive.day");
    const ben = await seat(tripId, "Ben Quinn", "NORA@dive.day");
    sesSend.mockClear();

    await joinMail([ben], tripId);

    const mail = sentMail();
    expect(mail.map((sent) => sent.to)).toEqual(["nora@dive.day"]);
    const token = mail[0]?.body.match(SIGN_STEP)?.[1];
    if (!token) throw new Error("no Sign step in the confirmation");
    expect(await verifyBookingCapability(db, { token, purpose: "readiness" })).toMatchObject({
      shopId: shop.id,
      bookingId: ben.bookingId,
    });
  });

  it("sends a party member on the lead's own address their seat's links there", async () => {
    configureMail();
    const { db, shop } = ctx;
    const tripId = await upcomingTripId();
    const lead = await seat(tripId, "Nora Quinn", "nora@dive.day");
    const ben = await seat(tripId, "Ben Quinn", "nora@dive.day");

    await joinMail([lead, ben], tripId);

    const tokens = sentMail()
      .filter((sent) => sent.to === "nora@dive.day")
      .map((sent) => sent.body.match(SIGN_STEP)?.[1])
      .filter((token): token is string => Boolean(token));
    const seats = await Promise.all(
      tokens.map((token) => verifyBookingCapability(db, { token, purpose: "readiness" })),
    );
    expect(seats.map((seat) => seat?.bookingId)).toContain(ben.bookingId);
    expect(
      await hasLiveDeliveredReadinessLink(db, { shopId: shop.id, bookingId: ben.bookingId }),
    ).toBe(true);
  });

  it("sends a minor member nothing: their release needs a guardian the address cannot prove (issue 3986)", async () => {
    configureMail();
    const { db } = ctx;
    const tripId = await upcomingTripId();
    const lead = await seat(tripId, "Nora Quinn", "nora@dive.day");
    const minor = await seat(tripId, "Pip Quinn", "pip@dive.day");
    // What the public party form writes for a seat declared Under 18.
    await db
      .update(bookings)
      .set({ minorDeclaredAt: nowDate(), contactTypedByLeadAt: nowDate() })
      .where(eq(bookings.id, minor.bookingId));
    await joinMail([lead, minor], tripId);

    expect(sentMail().filter((sent) => sent.to === "pip@dive.day")).toEqual([]);
    expect(
      await hasLiveDeliveredReadinessLink(db, { shopId: ctx.shop.id, bookingId: minor.bookingId }),
    ).toBe(false);
  });

  it("carries no Sign step when the booker owes no release", async () => {
    configureMail();
    const { db, shop } = ctx;
    const tripId = await upcomingTripId();
    const lead = await seat(tripId, "Nora Quinn", "nora@dive.day");
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Tom Quinn" })
      .where(eq(bookings.id, lead.bookingId));

    await joinMail([lead], tripId);

    for (const sent of sentMail()) {
      expect(sent.body).not.toMatch(SIGN_STEP);
      expect(sent.body).not.toContain("/waivers/");
    }
    expect(
      await db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, lead.bookingId)),
    ).toEqual([]);
    expect(await threadWaiverKey(db, { shopId: shop.id, bookingId: lead.bookingId })).toBeNull();
  });
});
