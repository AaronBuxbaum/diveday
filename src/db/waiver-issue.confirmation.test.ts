import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { applyProviderEmailEvent, recordNotificationDelivery } from "./notifications";
import { bookings, tripRequirements, waiverDeliveries, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import {
  issueJoinWaiverLink,
  resendConfirmationWithWaiver,
  settleJoinWaiverDelivery,
} from "./waiver-issue";
import { getDiverWaiverChannelStates, getDiverWaiverRequestStatus } from "./waivers";

/**
 * Issue #2473: the join waiver rides in the confirmation, so its delivery
 * follows the confirmation's provider message id, and a staff resend carries
 * the live waiver link again.
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

const ctx = fileScopedShopContext();

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
}

async function bookingWithWaiverOwed() {
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
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, outcome.bookingId));
  if (!row) throw new Error("booking missing");
  return { db, shop, tripId: trip.id, bookingId: outcome.bookingId, personId: row.personId };
}

describe("the join waiver follows the confirmation that carried it", () => {
  it("a bounce on the confirmation marks the waiver bounced too", async () => {
    configureMail();
    const { db, shop, bookingId, personId } = await bookingWithWaiverOwed();
    const link = await issueJoinWaiverLink(db, shop.id, bookingId);
    if (!link) throw new Error("no link");
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "ses-confirmation-1" },
    });
    await settleJoinWaiverDelivery(db, {
      shopId: shop.id,
      bookingId,
      link,
      confirmationSent: true,
      confirmationProviderMessageId: "ses-confirmation-1",
    });
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("not_signed");

    expect(
      await applyProviderEmailEvent(db, {
        providerMessageId: "ses-confirmation-1",
        status: "bounced",
        detail: "550 5.1.1",
        occurredAt: nowDate(),
      }),
    ).toBe("applied");

    const [channel] = await db
      .select({ providerStatus: waiverDeliveries.providerStatus })
      .from(waiverDeliveries)
      .where(eq(waiverDeliveries.waiverRecordId, link.waiverRecordId));
    expect(channel?.providerStatus).toBe("bounced");
    expect((await getDiverWaiverChannelStates(db, shop.id, personId)).email).toBe("failed");
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("failed");
    const [record] = await db
      .select({ status: waiverRecords.deliveryProviderStatus })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, link.waiverRecordId));
    expect(record?.status).toBe("bounced");
  });
});

describe("resendConfirmationWithWaiver", () => {
  function sentBody(): string {
    const command = sesSend.mock.calls.at(-1)?.[0] as SendEmailCommand | undefined;
    const content = command?.input.Content?.Simple?.Body;
    return `${content?.Text?.Data ?? ""}${content?.Html?.Data ?? ""}`;
  }

  it("carries the booking's live waiver link, the same one, and follows the resent mail", async () => {
    configureMail();
    sesSend.mockResolvedValue({ MessageId: "ses-resend-1" });
    const { db, shop, bookingId, personId } = await bookingWithWaiverOwed();
    const original = await issueJoinWaiverLink(db, shop.id, bookingId);
    if (!original) throw new Error("no link");

    const delivery = await resendConfirmationWithWaiver(db, shop.id, bookingId);
    expect(delivery).toMatchObject({ status: "sent", providerMessageId: "ses-resend-1" });
    const token = original.url.split("/waivers/")[1] ?? "";
    expect(token.length).toBeGreaterThan(20);
    expect(sentBody()).toContain(token);

    // One record: the live link was handed back, not replaced.
    const records = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, bookingId));
    expect(records.map((row) => row.id)).toEqual([original.waiverRecordId]);

    // And a bounce on the resent mail reaches the waiver.
    await applyProviderEmailEvent(db, {
      providerMessageId: "ses-resend-1",
      status: "bounced",
      detail: null,
      occurredAt: nowDate(),
    });
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("failed");
  });

  it("sends the plain confirmation when no waiver is owed", async () => {
    configureMail();
    sesSend.mockResolvedValue({ MessageId: "ses-resend-2" });
    const { db, shop, tripId, bookingId } = await bookingWithWaiverOwed();
    await db
      .insert(tripRequirements)
      .values({ tripId, shopId: shop.id, requiresWaiver: false })
      .onConflictDoUpdate({ target: tripRequirements.tripId, set: { requiresWaiver: false } });
    const delivery = await resendConfirmationWithWaiver(db, shop.id, bookingId);
    expect(delivery?.status).toBe("sent");
    expect(sentBody()).not.toContain("/waivers/");
    expect(
      await db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, bookingId)),
    ).toEqual([]);
  });
});
