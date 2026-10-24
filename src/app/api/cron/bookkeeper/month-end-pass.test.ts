import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  consumeBookkeeperConfirmation,
  issueBookkeeperConfirmation,
  readBookkeeper,
  recordBookkeeperDeliveryOutcome,
  setBookkeeper,
} from "@/db/bookkeeper";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
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
    await consumeBookkeeperConfirmation(db, { token: issued?.token ?? "", now: at, origin: null });
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
    // Its own stop link, from this month's claim (second-pass N1).
    expect(email.stopUrl).toMatch(new RegExp(`^${ORIGIN}/unsubscribe/[A-Za-z0-9_-]{40,}$`));

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
    expect(
      await sendDueMonthEndEmails(db, { now: SECOND, provider, origin: ORIGIN }),
    ).toMatchObject({
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
      await sendDueMonthEndEmails(db, { now: SECOND, provider: failing.provider, origin: ORIGIN }),
    ).toMatchObject({ due: 1, sent: 0, failed: 1 });
    const [row] = await db.select().from(shops).where(eq(shops.id, shopId));
    expect(row?.bookkeeperSentMonth).toBe("2026-09");

    const working = capturing();
    const retry = await sendDueMonthEndEmails(db, {
      now: new Date("2026-11-03T15:00:00Z"),
      provider: working.provider,
      origin: ORIGIN,
    });
    expect(retry.sent).toBe(1);
  });

  it("sends nothing, and claims nothing, without an origin to build the stop link from", async () => {
    const { db, shopId } = await shopWithBookkeeper();
    const { sent, provider } = capturing();
    expect(await sendDueMonthEndEmails(db, { now: SECOND, provider, origin: null })).toMatchObject({
      due: 1,
      sent: 0,
      failed: 1,
    });
    expect(sent).toEqual([]);
    const [row] = await db.select().from(shops).where(eq(shops.id, shopId));
    expect(row?.bookkeeperSentMonth).toBe("2026-09");
  });
});

describe("a month-end send that bounced (issue #2798)", () => {
  const BOUNCED_AT = new Date("2026-11-02T15:05:00Z");

  async function sentOnce() {
    const setup = await shopWithBookkeeper();
    const { provider } = capturing();
    await sendDueMonthEndEmails(setup.db, { now: SECOND, provider, origin: ORIGIN });
    return setup;
  }

  const outcome = (
    db: Parameters<typeof recordBookkeeperDeliveryOutcome>[0],
    shopId: string,
    input: { outcome: "bounced" | "delivered"; at?: Date; recipient?: string },
    provider: NotificationProvider,
  ) =>
    recordBookkeeperDeliveryOutcome(db, {
      shopId,
      recipient: input.recipient ?? "Books@Example.com",
      outcome: input.outcome,
      at: input.at ?? BOUNCED_AT,
      origin: ORIGIN,
      provider,
    });

  it("is held on the shop and told to every owner once, naming the address", async () => {
    const { db, shopId } = await sentOnce();
    const { sent, provider } = capturing();
    expect(await outcome(db, shopId, { outcome: "bounced" }, provider)).toBe("bounced");
    expect((await readBookkeeper(db, shopId))?.bouncedAt).toEqual(BOUNCED_AT);
    const notices = ofKind(sent, "bookkeeper_notice");
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      expect(notice).toMatchObject({ event: "bounced", email: BOOKS });
      // SES does not say which month's send bounced, so the notice names none.
      expect(notice.month).toBeUndefined();
      expect(messageFor(notice).subject).toContain(BOOKS);
    }
    expect(sent.filter((n) => n.kind !== "bookkeeper_notice")).toEqual([]);

    // SES saying it again tells nobody again.
    const again = capturing();
    expect(await outcome(db, shopId, { outcome: "bounced", at: SECOND }, again.provider)).toBe(
      "unchanged",
    );
    expect(again.sent).toEqual([]);
  });

  it("does not stop the next month's send, and a delivery after it clears it", async () => {
    const { db, shopId } = await sentOnce();
    const { provider } = capturing();
    await outcome(db, shopId, { outcome: "bounced" }, provider);
    const december = new Date("2026-12-02T15:00:00Z");
    const next = capturing();
    expect(
      await sendDueMonthEndEmails(db, { now: december, provider: next.provider, origin: ORIGIN }),
    ).toMatchObject({ sent: 1 });
    // A delivery older than the bounce is not the later send.
    expect(
      await outcome(
        db,
        shopId,
        { outcome: "delivered", at: new Date("2026-11-02T15:00:00Z") },
        provider,
      ),
    ).toBe("unchanged");
    expect(await outcome(db, shopId, { outcome: "delivered", at: december }, provider)).toBe(
      "cleared",
    );
    expect((await readBookkeeper(db, shopId))?.bouncedAt).toBeNull();
  });

  it("is cleared by a change of address, and never set for an address no longer on file", async () => {
    const { db, shopId, owner } = await sentOnce();
    const { sent, provider } = capturing();
    await outcome(db, shopId, { outcome: "bounced" }, provider);
    await setBookkeeper(db, {
      shopId,
      timeZone: "America/New_York",
      email: "fixed@example.com",
      personId: owner,
      now: new Date("2026-11-03T15:00:00Z"),
    });
    expect((await readBookkeeper(db, shopId))?.bouncedAt).toBeNull();
    sent.length = 0;
    // The old address bouncing late is about an address the shop no longer names.
    expect(await outcome(db, shopId, { outcome: "bounced" }, provider)).toBe("unchanged");
    expect((await readBookkeeper(db, shopId))?.bouncedAt).toBeNull();
    expect(sent).toEqual([]);
  });

  it("is cleared by the owner saving the same address again, as the notice asks", async () => {
    const { db, shopId, owner } = await sentOnce();
    const { provider } = capturing();
    await outcome(db, shopId, { outcome: "bounced" }, provider);
    const saved = await setBookkeeper(db, {
      shopId,
      timeZone: "America/New_York",
      email: BOOKS,
      personId: owner,
      now: new Date("2026-11-03T15:00:00Z"),
    });
    expect(saved).toEqual({ change: "resaved", confirmed: true });
    expect((await readBookkeeper(db, shopId))?.bouncedAt).toBeNull();
  });

  it("leaves another real shop naming the same address untouched, and both keep sending", async () => {
    const { db, shopId } = await sentOnce();
    const [other] = await db
      .insert(shops)
      .values({
        name: "Coral Ledge Divers",
        slug: "coral-ledge-bounce",
        timezone: "America/New_York",
        isDemo: false,
      })
      .returning({ id: shops.id });
    if (!other) throw new Error("no second shop");
    const [otherOwner] = await db
      .insert(people)
      .values({ shopId: other.id, fullName: "Coral Owner" })
      .returning({ id: people.id });
    if (!otherOwner) throw new Error("no second owner");
    await db.insert(personRoles).values({ personId: otherOwner.id, role: "owner" });
    await db.insert(userAccounts).values({
      personId: otherOwner.id,
      email: "owner@coral-ledge.example",
      hashedPassword: "x",
    });
    const setAt = new Date("2026-10-20T15:00:00Z");
    await setBookkeeper(db, {
      shopId: other.id,
      timeZone: "America/New_York",
      email: BOOKS,
      personId: otherOwner.id,
      now: setAt,
    });
    const issued = await issueBookkeeperConfirmation(db, {
      shopId: other.id,
      email: BOOKS,
      now: setAt,
    });
    await consumeBookkeeperConfirmation(db, {
      token: issued?.token ?? "",
      now: setAt,
      origin: null,
    });

    const { sent, provider } = capturing();
    await outcome(db, shopId, { outcome: "bounced" }, provider);
    expect((await readBookkeeper(db, shopId))?.bouncedAt).toEqual(BOUNCED_AT);
    expect((await readBookkeeper(db, other.id))?.bouncedAt).toBeNull();
    const bouncedNotices = ofKind(sent, "bookkeeper_notice");
    expect(bouncedNotices.length).toBeGreaterThan(0);
    expect(bouncedNotices.every((notice) => notice.shopId === shopId)).toBe(true);

    const december = capturing();
    expect(
      await sendDueMonthEndEmails(db, {
        now: new Date("2026-12-02T15:00:00Z"),
        provider: december.provider,
        origin: ORIGIN,
      }),
    ).toMatchObject({ sent: 2, failed: 0 });
    expect(
      ofKind(december.sent, "bookkeeper_month_end")
        .map((email) => email.shopId)
        .sort(),
    ).toEqual([shopId, other.id].sort());
  });

  it("is never set on another shop that names the same address", async () => {
    const { db, shopId } = await sentOnce();
    const { provider } = capturing();
    const otherShop = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
    expect(await outcome(db, otherShop, { outcome: "bounced" }, provider)).toBe("unchanged");
    expect((await readBookkeeper(db, shopId))?.bouncedAt).toBeNull();
  });
});
