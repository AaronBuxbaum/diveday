// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { bookings, notificationDeliveries, people, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { issueAndDeliverWaiver, issueWaiverOnJoin, issueWaiversForBookings } from "./waiver-issue";
import { completeWaiver, issueWaiverRequest } from "./waivers";

async function seededBooking(email: string | null = "diver@example.com") {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const outcome = await createBooking(db, {
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: email ?? "placeholder@example.com",
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  if (email === null) {
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, outcome.bookingId))
      .limit(1);
    if (row) await db.update(people).set({ email: null }).where(eq(people.id, row.personId));
  }
  return { db, shop, trip, bookingId: outcome.bookingId };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("issueAndDeliverWaiver", () => {
  it("emails the link and reports it sent when delivery is configured", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "shop@diveday.example");
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-id" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    const { db, shop, bookingId } = await seededBooking();
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "sent", diverName: "Nora Quinn" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [delivery] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(delivery?.status).toBe("sent");
  });

  it("surfaces the private link when email is not configured", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");

    const { db, shop, bookingId } = await seededBooking();
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "unconfigured" });
    if (result.ok) expect(result.token).toBeTruthy();
  });

  it("reports no_email when the diver has no address on file", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId } = await seededBooking(null);
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "no_email" });
  });

  it("does not reissue over a signed waiver", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
    });

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);
    expect(result).toMatchObject({ ok: false, reason: "already_completed" });
  });
});

describe("issueWaiversForBookings (bulk roster send)", () => {
  it("sends to each selected booking and leaves an already-signed diver alone", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo trip missing");
    const a = await createBooking(db, {
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Ann Able",
      email: "ann@example.com",
    });
    const b = await createBooking(db, {
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Ben Boyd",
      email: "ben@example.com",
    });
    if (!a.ok || !b.ok) throw new Error("setup booking failed");

    // Sign Ann's waiver; the bulk send must skip her, not reissue.
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: a.bookingId });
    if (!issued.ok) throw new Error("issue failed");
    await completeWaiver(db, issued.token, {
      signerName: "Ann Able",
      agreed: true,
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
    });

    const result = await issueWaiversForBookings(db, shop.id, [a.bookingId, b.bookingId]);
    expect(result).toEqual({ sent: 1, skipped: 1, failed: 0 });
  });

  it("collapses duplicate ids and counts an unknown booking as failed", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const result = await issueWaiversForBookings(db, shop.id, [
      bookingId,
      bookingId,
      "00000000-0000-4000-8000-000000000000",
    ]);
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1 });
  });
});

describe("issueWaiverOnJoin", () => {
  async function pendingWaiverCount(
    db: Awaited<ReturnType<typeof seededBooking>>["db"],
    bookingId: string,
  ) {
    const rows = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, bookingId));
    return rows.length;
  }

  it("issues a waiver the moment a diver joins a waiver-required trip", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const result = await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(result).toMatchObject({ ok: true });
    expect(await pendingWaiverCount(db, bookingId)).toBe(1);
  });

  it("is idempotent — a second join does not stack a second link", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await issueWaiverOnJoin(db, shop.id, bookingId);
    const second = await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(second).toBeNull();
    expect(await pendingWaiverCount(db, bookingId)).toBe(1);
  });

  it("skips a diver already covered by a current signature (sign-once)", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
    });
    const result = await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(result).toBeNull();
  });
});
