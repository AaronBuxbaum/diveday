// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { bookings, notificationDeliveries, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { issueAndDeliverWaiver } from "./waiver-issue";
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
