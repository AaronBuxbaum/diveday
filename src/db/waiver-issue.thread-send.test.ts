import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { verifyBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { bookingCapabilities, bookings, people, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { deliverWaiverBatch, issueAndDeliverWaiver } from "./waiver-issue";
import { getWaiverForToken, issueWaiverRequest } from "./waivers";

/**
 * Issue #2743, layer 2 (ADR 20261105-waiver-folds-into-the-thread): staff
 * "Send waiver" for a seat hands the holder their own thread link, on the
 * contact on file, and never puts a seat's credential in a staff browser:
 * no Copy link, and no fallback link when a send did not land (security
 * review of layer 1, "Copy link").
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

function configureMail() {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  vi.stubEnv("SES_AWS_REGION", "us-east-1");
  vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
  sesSend.mockResolvedValue({ MessageId: "ses-thread-send" });
}

async function seat(fullName = "Nora Quinn", email = "nora.thread@dive.day") {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName,
    email,
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, outcome.bookingId));
  if (!row) throw new Error("booking missing");
  return { db, shop, tripId: trip.id, bookingId: outcome.bookingId, personId: row.personId };
}

function lastMailBody(): string {
  const command = sesSend.mock.calls.at(-1)?.[0] as SendEmailCommand | undefined;
  const content = command?.input.Content?.Simple?.Body;
  return `${content?.Text?.Data ?? ""}${content?.Html?.Data ?? ""}`;
}

/** The readiness token in a `/ready/<token>/waiver` link, or null. */
function threadToken(body: string): string | null {
  return /\/ready\/([^/\s"<]+)\/waiver/.exec(body)?.[1] ?? null;
}

async function liveReadinessRows(bookingId: string) {
  return ctx.db
    .select({ delivered: bookingCapabilities.delivered })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.bookingId, bookingId),
        eq(bookingCapabilities.purpose, "readiness"),
      ),
    );
}

describe("staff Send waiver for a seat hands over the thread link", () => {
  it("emails the holder's own /ready/<token>/waiver, delivered, and no waiver link", async () => {
    configureMail();
    const { db, shop, bookingId, personId, tripId } = await seat();

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "sent", token: null });
    const body = lastMailBody();
    expect(body).not.toContain("/waivers/");
    const token = threadToken(body);
    if (!token) throw new Error("no thread link in the mail");
    const verified = await verifyBookingCapability(db, { token, purpose: "readiness" });
    expect(verified).toMatchObject({ bookingId, personId, tripId, delivered: true });
  });

  it("texts the same thread link, never a waiver link", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId, personId } = await seat();
    await db.update(people).set({ phone: "+13055550188" }).where(eq(people.id, personId));
    const sms = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "sns" }) };

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, {
      channel: "sms",
      textProviders: { whatsapp: null, sms },
    });

    expect(result).toMatchObject({ ok: true, delivery: "sent", token: null });
    const text: string = sms.send.mock.calls[0]?.[0]?.body ?? "";
    expect(text).not.toContain("/waivers/");
    const token = threadToken(text);
    if (!token) throw new Error("no thread link in the text");
    expect(await verifyBookingCapability(db, { token, purpose: "readiness" })).toMatchObject({
      bookingId,
      personId,
      delivered: true,
    });
  });

  it("refuses Copy link for a seat: nothing minted, nothing to copy", async () => {
    configureMail();
    const { db, shop, bookingId } = await seat();

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

    expect(result).toMatchObject({ ok: true, delivery: "thread_only", token: null });
    expect(JSON.stringify(result)).not.toMatch(/\/ready\/|\/waivers\//);
    expect(sesSend).not.toHaveBeenCalled();
    expect(await liveReadinessRows(bookingId)).toEqual([]);
  });

  it.each([
    ["no provider", "unconfigured"],
    ["a provider failure", "failed"],
  ] as const)("hands no link back after %s", async (_label, delivery) => {
    configureMail();
    if (delivery === "unconfigured") vi.stubEnv("SES_FROM_EMAIL", "");
    else sesSend.mockRejectedValue(Object.assign(new Error("nope"), { name: "MessageRejected" }));
    const { db, shop, bookingId } = await seat();

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery, token: null });
    expect(JSON.stringify(result)).not.toMatch(/\/ready\/|\/waivers\//);
  });

  it("mints nothing for a seat with no address on file", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId, personId } = await seat();
    await db.update(people).set({ email: null }).where(eq(people.id, personId));

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "no_email", token: null });
    expect(await liveReadinessRows(bookingId)).toEqual([]);
  });

  it("refuses a seat whose holder changed since the staffer's read", async () => {
    configureMail();
    const { db, shop, bookingId } = await seat();
    const other = await seat("Ola Other", "ola.thread@dive.day");

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, {
      expectedPersonId: other.personId,
    });

    expect(result).toMatchObject({ ok: false });
    expect(sesSend).not.toHaveBeenCalled();
    expect(await liveReadinessRows(bookingId)).toEqual([]);
  });

  it("keeps a waiver link sent earlier signable, on the same record", async () => {
    configureMail();
    const { db, shop, bookingId } = await seat();
    const earlier = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!earlier.ok) throw new Error(`issue failed: ${earlier.reason}`);

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "sent" });
    const opened = await getWaiverForToken(db, earlier.token);
    expect(opened.state).toBe("available");
    expect("record" in opened ? opened.record.id : null).toBe(earlier.recordId);
    const [row] = await db
      .select({
        supersededAt: waiverRecords.supersededAt,
        deliveryStatus: waiverRecords.deliveryStatus,
      })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, earlier.recordId));
    expect(row).toEqual({ supersededAt: null, deliveryStatus: "sent" });
  });

  it("hands the same thread link the confirmation carried on a second send", async () => {
    configureMail();
    const { db, shop, bookingId } = await seat();
    await issueAndDeliverWaiver(db, shop.id, bookingId);
    const first = threadToken(lastMailBody());
    await issueAndDeliverWaiver(db, shop.id, bookingId);
    expect(threadToken(lastMailBody())).toBe(first);
    expect((await liveReadinessRows(bookingId)).filter((row) => row.delivered)).toHaveLength(1);
  });
});

describe("deliverWaiverBatch for seats", () => {
  it("lists an undelivered seat by name with no link to hand over", async () => {
    configureMail();
    vi.stubEnv("SES_FROM_EMAIL", "");
    const { db, shop, bookingId } = await seat();

    const outcome = await deliverWaiverBatch(db, shop.id, {
      bookingIds: [bookingId],
      channel: "email",
    });

    expect(outcome.links).toEqual([
      { name: "Nora Quinn", token: null, bookingId, reason: "unconfigured" },
    ]);
    expect(JSON.stringify(outcome)).not.toMatch(/\/ready\/|\/waivers\//);
  });

  it("answers a Copy link tap on seats with no link", async () => {
    configureMail();
    const { db, shop, bookingId } = await seat();

    const outcome = await deliverWaiverBatch(db, shop.id, {
      bookingIds: [bookingId],
      channel: "link",
    });

    expect(outcome.links).toEqual([
      { name: "Nora Quinn", token: null, bookingId, reason: "thread_only" },
    ]);
  });
});
