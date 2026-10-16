import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setBookkeeper } from "@/db/bookkeeper";
import type { AppDb } from "@/db/client";
import { shops } from "@/db/schema";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { messageFor } from "@/lib/notifications/render";
import { unseededTestDb } from "@/test/db";
import { sendDueMonthEndEmails } from "./month-end-pass";

/**
 * The month-end pass (fifth loop, item 35): one email per shop per month, with
 * the three files, and a failed send gives the month back.
 */

const TZ = "America/New_York";
const SECOND = new Date("2026-11-02T15:00:00Z");

async function shopWithBookkeeper(db: AppDb, slug: string) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Blue Mantis Divers", slug, timezone: TZ })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  await setBookkeeper(db, {
    shopId: shop.id,
    timeZone: TZ,
    email: "books@example.com",
    personId: "11111111-1111-4111-8111-111111111111",
    now: new Date("2026-10-20T15:00:00Z"),
  });
  return shop.id;
}

function capturing(result: "sent" | "failed" = "sent") {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return result === "sent"
        ? { status: "sent", providerMessageId: `m-${sent.length}` }
        : { status: "failed", retryable: true, errorCode: "boom" };
    },
  };
  return { sent, provider };
}

describe("sendDueMonthEndEmails", () => {
  it("sends last month's three files once, from the shop's own 2nd", async () => {
    const db = await unseededTestDb();
    await shopWithBookkeeper(db, "month-end");
    const { sent, provider } = capturing();

    // The 1st is not yet due.
    const first = await sendDueMonthEndEmails(db, {
      now: new Date("2026-11-01T15:00:00Z"),
      provider,
    });
    expect(first.due).toBe(0);

    const summary = await sendDueMonthEndEmails(db, { now: SECOND, provider });
    expect(summary).toMatchObject({ due: 1, sent: 1, failed: 0 });
    const email = sent[0];
    if (email?.kind !== "bookkeeper_month_end") throw new Error("wrong kind");
    expect(email.to).toBe("books@example.com");
    expect(email.month).toBe("2026-10");
    expect(email.attachments.map((file) => file.fileName)).toEqual([
      expect.stringMatching(/^diveday-report-month-end-2026-10-.*\.csv$/),
      "diveday-orders-month-end-2026-10.csv",
      "crew-sheet-month-end-2026-10.csv",
    ]);
    expect(messageFor(email).subject).toBe("October 2026 at Blue Mantis Divers: month-end files");

    // A second pass that day finds the month sent.
    expect(await sendDueMonthEndEmails(db, { now: SECOND, provider })).toMatchObject({ due: 0 });
    expect(sent).toHaveLength(1);
  });

  it("gives the month back when the send fails, so the next pass tries again", async () => {
    const db = await unseededTestDb();
    const shopId = await shopWithBookkeeper(db, "month-end-retry");
    const failing = capturing("failed");
    expect(
      await sendDueMonthEndEmails(db, { now: SECOND, provider: failing.provider }),
    ).toMatchObject({ due: 1, sent: 0, failed: 1 });
    const [row] = await db.select().from(shops).where(eq(shops.id, shopId));
    expect(row?.bookkeeperSentMonth).toBe("2026-09");

    const working = capturing();
    const retry = await sendDueMonthEndEmails(db, {
      now: new Date("2026-11-03T15:00:00Z"),
      provider: working.provider,
    });
    expect(retry.sent).toBe(1);
  });
});
