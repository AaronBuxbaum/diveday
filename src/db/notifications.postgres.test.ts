import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { notificationSendQueue, shops } from "./schema";

describePostgres("notification retry claims across independent sessions", () => {
  it("sends once while overlapping drains compete for the same queued message", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Retry contention", slug: "retry-contention", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const notification: Notification = {
      kind: "password_reset_request",
      userAccountId: "00000000-0000-4000-8000-00000000a001",
      tokenId: "00000000-0000-4000-8000-00000000a002",
      ownerName: "Owner",
      shopId: shop.id,
      to: "owner@example.invalid",
      locale: "en-US",
      timezone: "UTC",
      expiresAt: nowDate(),
      resetUrl: "https://diveday.test/reset/test-only-token",
    };
    await expect(
      sendNotification(pg.db, notification, {
        async send() {
          return { status: "failed", retryable: true };
        },
      }),
    ).resolves.toMatchObject({ status: "failed", retryable: true });
    await pg.db.update(notificationSendQueue).set({ nextAttemptAt: new Date(0) });
    const [queued] = await pg.db.select().from(notificationSendQueue);
    if (!queued) throw new Error("retry missing");
    let releaseSend!: () => void;
    const heldSend = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    onTestFinished(() => releaseSend());
    let duplicateSend!: () => void;
    const duplicate = new Promise<"duplicate send">((resolve) => {
      duplicateSend = () => resolve("duplicate send");
    });
    let firstSend!: () => void;
    const started = new Promise<void>((resolve) => {
      firstSend = resolve;
    });
    let sends = 0;
    const provider: NotificationProvider = {
      async send() {
        sends += 1;
        firstSend();
        if (sends > 1) duplicateSend();
        await heldSend;
        return { status: "sent", providerMessageId: "retry-once" };
      },
    };
    const gate = await holdRowLock(
      pg,
      sql`select id from notification_send_queue where id = ${queued.id} for update`,
    );
    const drains = Array.from({ length: 2 }, () =>
      drainNotificationRetries(pg.connect(), { provider }),
    );
    // Both candidate SELECTs have happened before either conditional UPDATE can win.
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    try {
      // The provider remains suspended: a second claim cannot hide behind the winner's terminal write.
      expect(await Promise.race([...drains, duplicate])).toEqual({
        scanned: 1,
        sent: 0,
        queued: 0,
        failed: 0,
      });
      await started;
      expect(sends).toBe(1);
      expect(
        await pg.db
          .select()
          .from(notificationSendQueue)
          .where(eq(notificationSendQueue.id, queued.id)),
      ).toMatchObject([
        { status: "processing", attempts: queued.attempts + 1, recoveryAttempts: 0 },
      ]);
    } finally {
      releaseSend();
    }
    const summaries = await Promise.all(drains);
    expect(summaries.map((summary) => summary.sent).sort()).toEqual([0, 1]);
    expect(sends).toBe(1);
    expect(
      await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.id, queued.id)),
    ).toMatchObject([
      {
        status: "sent",
        attempts: queued.attempts + 1,
        recoveryAttempts: 0,
        payloadSealed: null,
        lockedUntil: null,
        providerMessageId: "retry-once",
      },
    ]);
  });
});
