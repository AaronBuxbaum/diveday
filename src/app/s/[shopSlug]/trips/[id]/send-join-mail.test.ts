import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyBookingCapability } from "@/db/booking-capabilities";
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
  const [lead] = seats;
  if (!lead) throw new Error("no lead");
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

  it("never carries another seat's release: a party member gets their own thread link", async () => {
    configureMail();
    const { db } = ctx;
    const tripId = await upcomingTripId();
    const lead = await seat(tripId, "Nora Quinn", "nora@dive.day");
    const friend = await seat(tripId, "Theo Marsh", "theo@dive.day");

    await joinMail([lead, friend], tripId);

    const mail = sentMail();
    const toLead = mail.filter((sent) => sent.to === "nora@dive.day");
    const toFriend = mail.filter((sent) => sent.to === "theo@dive.day");
    expect(toLead).toHaveLength(1);
    expect(toFriend).toHaveLength(1);
    const token = toLead[0]?.body.match(SIGN_STEP)?.[1];
    if (!token) throw new Error("no Sign step in the confirmation");
    const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
    expect(capability?.bookingId).toBe(lead.bookingId);
    expect(toLead[0]?.body).not.toContain("/waivers/");
    // The friend's own release goes on the friend's own thread link, to them
    // alone, never on the lead's (issue #2743).
    expect(toFriend[0]?.body).not.toContain("/waivers/");
    const friendToken = toFriend[0]?.body.match(SIGN_STEP)?.[1];
    if (!friendToken) throw new Error("no thread link to the friend");
    expect(friendToken).not.toBe(token);
    expect(
      await verifyBookingCapability(db, { token: friendToken, purpose: "readiness" }),
    ).toMatchObject({ bookingId: friend.bookingId, delivered: true });
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
