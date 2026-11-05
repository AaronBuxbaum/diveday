import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import { bookings, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { issueWaiverOnJoin, openJoinSignStep, settleJoinWaiverDelivery } from "./waiver-issue";
import { completeWaiver, getWaiverForToken, issueWaiverRequest, threadWaiverKey } from "./waivers";

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

// One seeded database for the file and a rolled-back transaction per test
// (`fileScopedShopContext` in src/test/db.ts); a demo shop sends no mail.
const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

async function seededBooking() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "delivered@dive.day",
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  return { db, shop, trip, bookingId: outcome.bookingId };
}

/**
 * **One booking, one email, one link** (UX review 2026-10-11, item 7; issue
 * #2743). The lead's release is opened on their seat for the confirmation to
 * carry as the thread's Sign step, with no waiver link handed to anyone, and
 * settled by how that confirmation went: recorded as emailed when it left,
 * mailed on its own on the same record when it did not.
 */
describe("openJoinSignStep and settleJoinWaiverDelivery", () => {
  it("opens the seat's release for its thread, hands over no link, and sends nothing", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    sesSend.mockReset();
    const { db, shop, trip, bookingId } = await seededBooking();
    const step = await openJoinSignStep(db, shop.id, bookingId);
    if (!step) throw new Error("no sign step");
    // A record and the seat it is on; nothing a reader could open a page with.
    expect(Object.keys(step).sort()).toEqual(["personId", "tripId", "waiverRecordId"]);
    expect(step.tripId).toBe(trip.id);
    expect(sesSend).not.toHaveBeenCalled();
    // The thread reaches exactly that record.
    const key = await threadWaiverKey(db, { shopId: shop.id, bookingId });
    expect(key?.recordId).toBe(step.waiverRecordId);
    expect((await getWaiverForToken(db, key ?? "")).state).toBe("available");
    // The join rule still holds: a second ask finds the release already out.
    expect(await openJoinSignStep(db, shop.id, bookingId)).toBeNull();
    expect(await issueWaiverOnJoin(db, shop.id, bookingId)).toBeNull();
  });

  it("opens nothing when there is no origin for the readiness link it rides on", async () => {
    vi.stubEnv("APP_HOST", "");
    const { db, shop, bookingId } = await seededBooking();
    expect(await openJoinSignStep(db, shop.id, bookingId)).toBeNull();
    expect(
      await db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, bookingId)),
    ).toEqual([]);
  });

  it("opens nothing for a diver whose signature still covers the trip", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    expect(await openJoinSignStep(db, shop.id, bookingId)).toBeNull();
  });

  it("opens nothing on a held seat", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId } = await seededBooking();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Tom Quinn" })
      .where(eq(bookings.id, bookingId));
    expect(await openJoinSignStep(db, shop.id, bookingId)).toBeNull();
    expect(
      await db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, bookingId)),
    ).toEqual([]);
  });

  it("opens nothing on a cancelled seat", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId } = await seededBooking();
    await cancelBooking(db, shop.id, bookingId);
    expect(await openJoinSignStep(db, shop.id, bookingId)).toBeNull();
  });

  it("records the release as emailed when the confirmation carried it, and mails nothing more", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    sesSend.mockReset();
    const { db, shop, bookingId } = await seededBooking();
    const step = await openJoinSignStep(db, shop.id, bookingId);
    if (!step) throw new Error("no sign step");
    await settleJoinWaiverDelivery(db, {
      shopId: shop.id,
      bookingId,
      step,
      confirmationSent: true,
    });
    expect(sesSend).not.toHaveBeenCalled();
    const [record] = await db
      .select({ deliveryStatus: waiverRecords.deliveryStatus })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, step.waiverRecordId));
    expect(record?.deliveryStatus).toBe("sent");
  });

  it("mails a waiver link on its own, on the same record, when the confirmation did not go", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockReset().mockResolvedValue({ MessageId: "ses-id" });
    const { db, shop, bookingId } = await seededBooking();
    const step = await openJoinSignStep(db, shop.id, bookingId);
    if (!step) throw new Error("no sign step");
    await settleJoinWaiverDelivery(db, {
      shopId: shop.id,
      bookingId,
      step,
      confirmationSent: false,
    });
    expect(sesSend).toHaveBeenCalledOnce();
    const records = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, bookingId));
    expect(records.map((row) => row.id)).toEqual([step.waiverRecordId]);
  });
});
