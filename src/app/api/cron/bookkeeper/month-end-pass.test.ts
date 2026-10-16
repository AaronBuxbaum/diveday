import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  consumeBookkeeperConfirmation,
  issueBookkeeperConfirmation,
  setBookkeeper,
} from "@/db/bookkeeper";
import { personRoles, shops } from "@/db/schema";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { messageFor } from "@/lib/notifications/render";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { sendDueMonthEndEmails } from "./month-end-pass";

/**
 * The month-end pass (fifth loop, item 35): one email per shop per month, with
 * the three files, only to an address its inbox confirmed (security review
 * B1), only while whoever set it can still export the shop's data (F1), with
 * a line to every owner on each send; a failed send gives the month back.
 */

const ctx = fileScopedShopContext();
const SECOND = new Date("2026-11-02T15:00:00Z");
const BOOKS = "books@example.com";
const ORIGIN = "https://diveday.example";

async function shopWithBookkeeper({ confirm = true } = {}) {
  const { db, shop } = ctx;
  await db
    .update(shops)
    .set({ isDemo: false, name: "Blue Mantis Divers", timezone: "America/New_York" })
    .where(eq(shops.id, shop.id));
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const at = new Date("2026-10-20T15:00:00Z");
  await setBookkeeper(db, {
    shopId: shop.id,
    timeZone: "America/New_York",
    email: BOOKS,
    personId: owner,
    now: at,
  });
  if (confirm) {
    const issued = await issueBookkeeperConfirmation(db, {
      shopId: shop.id,
      email: BOOKS,
      now: at,
    });
    await consumeBookkeeperConfirmation(db, { token: issued?.token ?? "", now: at });
  }
  return { db, shopId: shop.id, owner };
}

function capturing(result: "sent" | "failed" = "sent") {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      const ok = result === "sent" || notification.kind !== "bookkeeper_month_end";
      return ok
        ? { status: "sent", providerMessageId: `m-${sent.length}` }
        : { status: "failed", retryable: true, errorCode: "boom" };
    },
  };
  return { sent, provider };
}

const ofKind = <K extends Notification["kind"]>(sent: Notification[], kind: K) =>
  sent.filter((n): n is Extract<Notification, { kind: K }> => n.kind === kind);

describe("sendDueMonthEndEmails", () => {
  it("sends last month's three files once, from the shop's own 2nd, and tells every owner", async () => {
    const { db } = await shopWithBookkeeper();
    const { sent, provider } = capturing();

    // The 1st is not yet due.
    const first = await sendDueMonthEndEmails(db, {
      now: new Date("2026-11-01T15:00:00Z"),
      provider,
      origin: ORIGIN,
    });
    expect(first.due).toBe(0);

    const summary = await sendDueMonthEndEmails(db, { now: SECOND, provider, origin: ORIGIN });
    expect(summary).toMatchObject({ due: 1, sent: 1, failed: 0, setterLapsed: 0 });
    const [email] = ofKind(sent, "bookkeeper_month_end");
    if (!email) throw new Error("no month-end email");
    expect(email.to).toBe(BOOKS);
    expect(email.month).toBe("2026-10");
    expect(email.attachments.map((file) => file.fileName)).toEqual([
      expect.stringMatching(/^diveday-report-.*2026-10.*\.csv$/),
      expect.stringMatching(/^diveday-orders-.*-2026-10\.csv$/),
      expect.stringMatching(/^crew-sheet-.*-2026-10\.csv$/),
    ]);
    expect(messageFor(email).subject).toBe("October 2026 at Blue Mantis Divers: month-end files");

    // Each owner hears where the files went, in one line.
    const notices = ofKind(sent, "bookkeeper_notice");
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[0]).toMatchObject({ event: "sent", email: BOOKS, month: "2026-10" });
    expect(messageFor(notices[0] as Notification).text).toContain(
      "Month-end files for October 2026 sent to books@example.com.",
    );

    // A second pass that day finds the month sent.
    expect(
      await sendDueMonthEndEmails(db, { now: SECOND, provider, origin: ORIGIN }),
    ).toMatchObject({ due: 0 });
    expect(ofKind(sent, "bookkeeper_month_end")).toHaveLength(1);
  });

  it("sends nothing to an address whose inbox has not confirmed", async () => {
    const { db } = await shopWithBookkeeper({ confirm: false });
    const { sent, provider } = capturing();
    expect(await sendDueMonthEndEmails(db, { now: SECOND, provider })).toMatchObject({ due: 0 });
    expect(sent).toEqual([]);
  });

  it("holds the files when whoever set the address can no longer export the shop's data", async () => {
    const { db, owner } = await shopWithBookkeeper();
    await db.delete(personRoles).where(eq(personRoles.personId, owner));
    const { sent, provider } = capturing();
    expect(await sendDueMonthEndEmails(db, { now: SECOND, provider })).toMatchObject({
      due: 1,
      sent: 0,
      setterLapsed: 1,
    });
    expect(sent).toEqual([]);
  });

  it("gives the month back when the send fails, so the next pass tries again", async () => {
    const { db, shopId } = await shopWithBookkeeper();
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
