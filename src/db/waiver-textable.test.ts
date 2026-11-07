import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { CourtesyProviders } from "@/lib/notifications/courtesy";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { bookings, people } from "./schema";
import { recordSmsKeyword } from "./sms-opt-outs";
import { upcomingTripsWithCounts } from "./trips";
import { deliverWaiverBatch, issueAndDeliverWaiver, textableSeats } from "./waiver-issue";

/**
 * **Whether a seat can be texted** (issue #4039). A number on file is not
 * enough: the shop has to have a way to text (its own WhatsApp, or platform
 * SMS), and the number must not be on the STOP list, which holds on both. A
 * seat that cannot be texted is offered the counter instead of a text that
 * could only fail.
 */
const ctx = fileScopedShopContext({ realShop: true });
const PHONE = "+13055550177";

afterEach(() => vi.unstubAllEnvs());

function configureSms() {
  vi.stubEnv("SNS_AWS_REGION", "us-east-1");
  vi.stubEnv("SNS_AWS_ACCESS_KEY_ID", "AKIA_TEST");
  vi.stubEnv("SNS_AWS_SECRET_ACCESS_KEY", "test-secret");
}

function noSms() {
  vi.stubEnv("SNS_AWS_REGION", "");
  vi.stubEnv("SNS_AWS_ACCESS_KEY_ID", "");
  vi.stubEnv("SNS_AWS_SECRET_ACCESS_KEY", "");
}

/** A seat with a number and no email, so an email send cannot land. */
async function phoneOnlySeat() {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Lena Textable",
    email: `lena.${crypto.randomUUID().slice(0, 6)}@dive.day`,
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, outcome.bookingId));
  if (!row) throw new Error("booking missing");
  await db.update(people).set({ email: null, phone: PHONE }).where(eq(people.id, row.personId));
  return { db, shop, tripId: trip.id, bookingId: outcome.bookingId };
}

describe("can be texted (issue #4039)", () => {
  it("is a number on file at a shop that can send a text", async () => {
    configureSms();
    const { db, shop, bookingId } = await phoneOnlySeat();
    const outcome = await deliverWaiverBatch(db, shop.id, {
      bookingIds: [bookingId],
      channel: "email",
    });
    expect(outcome.links).toEqual([
      { name: "Lena Textable", token: null, bookingId, textable: true, reason: "no_email" },
    ]);
    expect(await textableSeats(db, shop.id, [{ bookingId, phone: PHONE }])).toEqual(
      new Set([bookingId]),
    );
  });

  it("is not, at a shop with no SMS and no WhatsApp, and the seat is offered the counter", async () => {
    noSms();
    const { db, shop, bookingId, tripId } = await phoneOnlySeat();
    const outcome = await deliverWaiverBatch(db, shop.id, {
      bookingIds: [bookingId],
      channel: "email",
    });
    expect(outcome.links).toEqual([
      {
        name: "Lena Textable",
        token: null,
        bookingId,
        textable: false,
        counter: { shopSlug: shop.slug, tripId, leadBookingId: bookingId },
        reason: "no_email",
      },
    ]);
    expect(await textableSeats(db, shop.id, [{ bookingId, phone: PHONE }])).toEqual(new Set());
  });

  it("is not, for a number on the STOP list", async () => {
    configureSms();
    const { db, shop, bookingId } = await phoneOnlySeat();
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: nowDate() });
    const outcome = await deliverWaiverBatch(db, shop.id, {
      bookingIds: [bookingId],
      channel: "email",
    });
    expect(outcome.links).toMatchObject([{ bookingId, textable: false }]);
    expect(await textableSeats(db, shop.id, [{ bookingId, phone: PHONE }])).toEqual(new Set());
  });

  it("is, at a shop with its own WhatsApp and no SMS", async () => {
    const { db, shop, bookingId } = await phoneOnlySeat();
    const providers: CourtesyProviders = {
      whatsapp: { send: vi.fn() },
      sms: { configured: false, send: vi.fn() },
    };
    expect(
      await issueAndDeliverWaiver(db, shop.id, bookingId, { textProviders: providers }),
    ).toMatchObject({ ok: true, delivery: "no_email", textable: true });
    expect(providers.whatsapp?.send).not.toHaveBeenCalled();
  });
});
