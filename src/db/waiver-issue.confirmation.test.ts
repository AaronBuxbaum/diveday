import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { verifyBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { applyProviderEmailEvent, recordNotificationDelivery } from "./notifications";
import { bookings, tripRequirements, waiverDeliveries, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import {
  openJoinSignStep,
  resendConfirmationWithWaiver,
  settleJoinWaiverDelivery,
} from "./waiver-issue";
import {
  getDiverWaiverChannelStates,
  getDiverWaiverRequestStatus,
  getWaiverForToken,
  issueWaiverRequest,
} from "./waivers";

/**
 * Issue #2473: the join waiver rides in the confirmation, so its delivery
 * follows the confirmation's provider message id, and a staff resend carries
 * the seat's release again. Issue #2743: it rides as the thread's Sign step,
 * on the readiness link the mail already carries, never as a waiver link.
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
    const step = await openJoinSignStep(db, shop.id, bookingId);
    if (!step) throw new Error("no sign step");
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "ses-confirmation-1" },
    });
    await settleJoinWaiverDelivery(db, {
      shopId: shop.id,
      bookingId,
      step,
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
      .where(eq(waiverDeliveries.waiverRecordId, step.waiverRecordId));
    expect(channel?.providerStatus).toBe("bounced");
    expect((await getDiverWaiverChannelStates(db, shop.id, personId)).email).toBe("failed");
    expect(await getDiverWaiverRequestStatus(db, shop.id, personId)).toBe("failed");
    const [record] = await db
      .select({ status: waiverRecords.deliveryProviderStatus })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, step.waiverRecordId));
    expect(record?.status).toBe("bounced");
  });
});

describe("resendConfirmationWithWaiver", () => {
  function sentBody(): string {
    const command = sesSend.mock.calls.at(-1)?.[0] as SendEmailCommand | undefined;
    const content = command?.input.Content?.Simple?.Body;
    return `${content?.Text?.Data ?? ""}${content?.Html?.Data ?? ""}`;
  }

  /** The readiness token in the mail's Sign step, which must be its readiness link's own. */
  function signStepToken(body: string): string {
    const match = body.match(/\/ready\/([A-Za-z0-9._-]+)\/waiver/);
    if (!match?.[1]) throw new Error("no Sign step in the mail");
    return match[1];
  }

  it("carries the seat's release as the Sign step on its own readiness link, and follows the resent mail", async () => {
    configureMail();
    sesSend.mockResolvedValue({ MessageId: "ses-resend-1" });
    const { db, shop, bookingId, personId } = await bookingWithWaiverOwed();
    const original = await openJoinSignStep(db, shop.id, bookingId);
    if (!original) throw new Error("no sign step");

    const delivery = await resendConfirmationWithWaiver(db, shop.id, bookingId);
    expect(delivery).toMatchObject({ status: "sent", providerMessageId: "ses-resend-1" });
    const body = sentBody();
    // One credential: no waiver link, and the Sign step opens on the mail's
    // own readiness link, which opens this seat and no other.
    expect(body).not.toContain("/waivers/");
    const token = signStepToken(body);
    expect(body).toContain(`https://diveday.example/ready/${token}`);
    const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
    expect(capability).toMatchObject({ shopId: shop.id, bookingId });

    // One record: the live release was kept, not replaced.
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

  it("keeps a waiver link a staffer already sent working beside the Sign step", async () => {
    configureMail();
    sesSend.mockResolvedValue({ MessageId: "ses-resend-3" });
    const { db, shop, bookingId } = await bookingWithWaiverOwed();
    const sent = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!sent.ok) throw new Error(`issue failed: ${sent.reason}`);

    await resendConfirmationWithWaiver(db, shop.id, bookingId);
    expect(sentBody()).not.toContain(sent.token);
    signStepToken(sentBody());
    // The link in the diver's hands still opens the same, unsigned record.
    const state = await getWaiverForToken(db, sent.token);
    expect(state.state).toBe("available");
    expect(state.state === "available" ? state.record.id : null).toBe(sent.recordId);
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
    expect(sentBody()).not.toMatch(/\/ready\/[A-Za-z0-9._-]+\/waiver/);
    expect(
      await db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, bookingId)),
    ).toEqual([]);
  });
});
