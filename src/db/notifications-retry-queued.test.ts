import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import {
  sendAndRecordNotification,
  sendNotification,
  sendNotificationBatch,
} from "./notifications";
import { notificationSendQueue } from "./schema";

const ctx = fileScopedShopContext();
const failed = { status: "failed" as const, retryable: true, errorCode: "temporary_failure" };

function systemNotification(
  shopId: string,
  kind: "address_confirmation" | "password_reset_request",
) {
  const token = randomUUID();
  const common = {
    userAccountId: randomUUID(),
    ownerName: "Shop owner",
    tokenId: randomUUID(),
    shopId,
    to: "front-desk@example.invalid",
    locale: "en-US" as const,
    expiresAt: new Date("2026-09-05T12:00:00.000Z"),
    timezone: "America/New_York",
  };
  return kind === "address_confirmation"
    ? ({
        ...common,
        kind,
        purpose: "account",
        confirmUrl: `https://diveday.test/verify/${token}`,
      } satisfies Notification)
    : ({ ...common, kind, resetUrl: `https://diveday.test/reset/${token}` } satisfies Notification);
}

function failingProvider(): NotificationProvider {
  return {
    async send() {
      return failed;
    },
    async sendBatch(notifications) {
      return notifications.map(() => failed);
    },
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("retry queue persistence results", () => {
  it("reports a single system retry only after its sealed row is durable", async () => {
    const { db, shop } = ctx;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));

    const result = await sendNotification(
      db,
      systemNotification(shop.id, "address_confirmation"),
      failingProvider(),
    );

    expect(result).toMatchObject({ status: "failed", retryable: true, retryQueued: true });
    const [row] = await db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.shopId, shop.id));
    expect(row?.recipientPersonId).toBeNull();
    expect(row?.payloadSealed).toMatch(/^v1\./);
  });

  it("reports a batch system retry only after its sealed row is durable", async () => {
    const { db, shop } = ctx;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));

    const [result] = await sendNotificationBatch(
      db,
      [systemNotification(shop.id, "password_reset_request")],
      failingProvider(),
    );

    expect(result).toMatchObject({ status: "failed", retryable: true, retryQueued: true });
    const [row] = await db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.shopId, shop.id));
    expect(row?.recipientPersonId).toBeNull();
    expect(row?.payloadSealed).toMatch(/^v1\./);
  });

  it("reports queue refusal for single and batch failures", async () => {
    const { db, shop } = ctx;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");

    const single = await sendNotification(
      db,
      systemNotification(shop.id, "address_confirmation"),
      failingProvider(),
    );
    const [batch] = await sendNotificationBatch(
      db,
      [systemNotification(shop.id, "password_reset_request")],
      failingProvider(),
    );

    expect(single).toMatchObject({ status: "failed", retryable: true, retryQueued: false });
    expect(batch).toMatchObject({ status: "failed", retryable: true, retryQueued: false });
  });

  it("does not report a retry as queued when the same key is already terminal", async () => {
    const { db, shop } = ctx;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const notification = systemNotification(shop.id, "address_confirmation");

    const first = await sendNotification(db, notification, failingProvider());
    expect(first).toMatchObject({ status: "failed", retryable: true, retryQueued: true });
    const whileQueued = await sendNotification(db, notification, failingProvider());
    expect(whileQueued).toMatchObject({ status: "failed", retryable: true, retryQueued: true });
    await db
      .update(notificationSendQueue)
      .set({ status: "failed", payloadSealed: null, errorCode: "retry_exhausted" })
      .where(eq(notificationSendQueue.shopId, shop.id));

    const repeated = await sendNotification(db, notification, failingProvider());

    expect(repeated).toMatchObject({ status: "failed", retryable: true, retryQueued: false });
  });

  it("can leave a retryable failure unqueued when the caller owns its recovery", async () => {
    const { db, shop } = ctx;
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));

    const single = await sendNotification(
      db,
      systemNotification(shop.id, "address_confirmation"),
      failingProvider(),
      { retryPolicy: "disabled" },
    );
    const recorded = await sendAndRecordNotification(
      db,
      systemNotification(shop.id, "password_reset_request"),
      { provider: failingProvider(), retryPolicy: "disabled" },
    );

    expect(single).toMatchObject({ status: "failed", retryable: true, retryQueued: false });
    expect(recorded).toMatchObject({ status: "failed", retryable: true, retryQueued: false });
    expect(await db.select().from(notificationSendQueue)).toEqual([]);
  });
});
