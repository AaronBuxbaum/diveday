import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AFTER_HOURS_PING_INTERVAL_MS } from "@/lib/desk-hours";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import {
  countWaitingSince,
  pingDeskAfterHours,
  readAfterHoursPingChoice,
  sendTrailingDeskPings,
  setAfterHoursPingChoice,
  setShopDeskHours,
} from "./desk-pings";
import { markInboundAnswered, recordInboundMessage } from "./inbound-messages";
import { people, personRoles, shops, userAccounts } from "./schema";

/**
 * **The desk is pinged when divers write in after hours** (D4, Aaron
 * 2026-10-09): the shop's own hours decide "after", the staffer's own answer
 * (or their role's) decides who, and the batching clock keeps it to one email
 * per person per interval, naming how many divers are waiting and nothing they
 * said.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";
const ZONE = "America/New_York";
// 2026-10-09 is EDT (UTC-4). 23:00 local, and 10:00 local.
const NIGHT = new Date("2026-10-10T03:00:00Z");
const MIDDAY = new Date("2026-10-09T14:00:00Z");

function recorder(status: "sent" | "failed" = "sent") {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return status === "sent"
        ? { status: "sent", providerMessageId: `msg-${sent.length}` }
        : { status: "failed", retryable: false, errorCode: "test" };
    },
  };
  return { sent, provider };
}

async function context() {
  const { db, shop } = ctx;
  // The seeded shop is a demo, which never pings; these tests are about a
  // real shop's desk. Rolled back with the rest of the test.
  await db.update(shops).set({ isDemo: false, timezone: ZONE }).where(eq(shops.id, shop.id));
  await setShopDeskHours(db, shop.id, { opensMinute: 8 * 60, closesMinute: 18 * 60 });
  return { db, shop };
}

/** The active logins at the shop holding any of `roles`. */
async function loginsWith(roles: ("owner" | "manager" | "crew" | "divemaster")[]) {
  const { db, shop } = ctx;
  const rows = await db
    .selectDistinct({ personId: people.id, email: userAccounts.email })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shop.id),
        eq(userAccounts.status, "active"),
        inArray(personRoles.role, roles),
      ),
    );
  return rows;
}

async function diverWrites(
  at: Date,
  from = `diver-${randomUUID()}@example.com`,
  vouched: { senderAuthenticated?: boolean; spamFlagged?: boolean } = {},
) {
  const { db, shop } = ctx;
  const result = await recordInboundMessage(db, {
    shopId: shop.id,
    channel: "email",
    fromAddress: from,
    subject: "Night dive?",
    body: "Is there room on Saturday’s night dive? My cert is in my bag.",
    receivedAt: at,
    providerMessageId: `ses-${randomUUID()}`,
    senderAuthenticated: vouched.senderAuthenticated ?? true,
    spamFlagged: vouched.spamFlagged,
  });
  if (result.status !== "recorded") throw new Error("message not filed");
  return result.id;
}

describe("pingDeskAfterHours", () => {
  it("stays quiet while the desk is open", async () => {
    const { db, shop } = await context();
    await diverWrites(MIDDAY);
    const { sent, provider } = recorder();
    const outcome = await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: MIDDAY,
      now: MIDDAY,
      origin: ORIGIN,
      provider,
    });
    expect(outcome.status).toBe("in_hours");
    expect(sent).toEqual([]);
  });

  it("pings the owner and managers by default, with a count and a link and nothing a diver wrote", async () => {
    const { db, shop } = await context();
    await diverWrites(NIGHT);
    const { sent, provider } = recorder();
    const outcome = await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider,
    });

    const desk = await loginsWith(["owner", "manager"]);
    expect(desk.length).toBeGreaterThan(0);
    expect(outcome).toMatchObject({ status: "pinged", sent: desk.length, failed: 0 });
    expect(sent.map((n) => n.to).sort()).toEqual(desk.map((row) => row.email).sort());
    const [first] = sent;
    if (first?.kind !== "desk_after_hours") throw new Error("wrong kind");
    expect(first.waiting).toBe(1);
    expect(first.inboxUrl).toBe(`${ORIGIN}/shop/${shop.slug}/inbox`);
    expect(first.settingsUrl).toBe(`${ORIGIN}/shop/${shop.slug}/settings/email`);
    // Nothing of the message rides along: not its words, subject or sender.
    const payload = JSON.stringify(sent);
    expect(payload).not.toContain("night dive");
    expect(payload).not.toContain("Night dive?");
    expect(payload).not.toContain("diver-");
  });

  it("leaves crew out unless they asked, and leaves out an owner who said no", async () => {
    const { db, shop } = await context();
    const [crew] = await loginsWith(["crew", "divemaster"]);
    const [owner] = await loginsWith(["owner"]);
    if (!crew || !owner) throw new Error("demo staff missing crew or an owner");
    await setAfterHoursPingChoice(db, { shopId: shop.id, personId: crew.personId, wanted: true });
    await setAfterHoursPingChoice(db, { shopId: shop.id, personId: owner.personId, wanted: false });
    await diverWrites(NIGHT);
    const { sent, provider } = recorder();
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider,
    });
    const to = sent.map((n) => n.to);
    expect(to).toContain(crew.email);
    expect(to).not.toContain(owner.email);
  });

  it("batches: one ping per person per interval, and the next one names everyone waiting", async () => {
    const { db, shop } = await context();
    const desk = await loginsWith(["owner", "manager"]);
    await diverWrites(NIGHT);
    const first = recorder();
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider: first.provider,
    });
    expect(first.sent).toHaveLength(desk.length);

    const soon = new Date(NIGHT.getTime() + 5 * 60_000);
    await diverWrites(soon);
    const second = recorder();
    const batched = await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: soon,
      now: soon,
      origin: ORIGIN,
      provider: second.provider,
    });
    expect(second.sent).toEqual([]);
    expect(batched).toMatchObject({ status: "pinged", sent: 0, batched: desk.length });

    const later = new Date(NIGHT.getTime() + AFTER_HOURS_PING_INTERVAL_MS + 60_000);
    await diverWrites(later);
    const third = recorder();
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: later,
      now: later,
      origin: ORIGIN,
      provider: third.provider,
    });
    expect(third.sent).toHaveLength(desk.length);
    const [ping] = third.sent;
    if (ping?.kind !== "desk_after_hours") throw new Error("wrong kind");
    expect(ping.waiting).toBe(3);
  });

  it("gives the clock back when the send did not go", async () => {
    const { db, shop } = await context();
    await diverWrites(NIGHT);
    const failing = recorder("failed");
    const outcome = await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider: failing.provider,
    });
    expect(outcome).toMatchObject({ status: "pinged", sent: 0 });
    const soon = new Date(NIGHT.getTime() + 60_000);
    const retry = recorder();
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: soon,
      now: soon,
      origin: ORIGIN,
      provider: retry.provider,
    });
    expect(retry.sent.length).toBe(failing.sent.length);
  });

  it("counts divers, not messages, and only those nobody has answered", async () => {
    const { db, shop } = await context();
    const since = new Date(NIGHT.getTime() - 60 * 60_000);
    const before = await countWaitingSince(db, shop.id, since);
    await diverWrites(NIGHT, "same@example.com");
    await diverWrites(NIGHT, "same@example.com");
    const answered = await diverWrites(NIGHT);
    expect(await countWaitingSince(db, shop.id, since)).toBe(before + 2);
    await markInboundAnswered(db, shop.id, answered, NIGHT);
    expect(await countWaitingSince(db, shop.id, since)).toBe(before + 1);
  });

  /**
   * **The count is no wider than the trigger** (#2311). The ping fires only on
   * mail whose sender SES vouched for and did not flag as spam, so "3 divers
   * waiting" must not count a spoofed or junk message that could never have
   * pinged on its own.
   */
  it("counts only senders the channel vouched for, and nothing flagged as spam", async () => {
    const { db, shop } = await context();
    const since = new Date(NIGHT.getTime() - 60 * 60_000);
    const before = await countWaitingSince(db, shop.id, since);
    await diverWrites(NIGHT, "spoofed@example.com", { senderAuthenticated: false });
    await diverWrites(NIGHT, "junk@example.com", { spamFlagged: true });
    expect(await countWaitingSince(db, shop.id, since)).toBe(before);
    await diverWrites(NIGHT, "real@example.com");
    expect(await countWaitingSince(db, shop.id, since)).toBe(before + 1);
  });

  it("never pings from a demo shop", async () => {
    const { db, shop } = await context();
    await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
    await diverWrites(NIGHT);
    const { sent, provider } = recorder();
    const outcome = await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider,
    });
    expect(outcome.status).toBe("demo");
    expect(sent).toEqual([]);
  });
});

/**
 * **The trailing ping** (#2311). The batching clock keeps it to one email per
 * staffer per half hour, which used to mean a message landing inside that
 * half hour, with nothing after it, waited until morning. The hourly sweep
 * sends one catch-up once the clock has run out, if anything that arrived
 * after the last ping is still unanswered.
 */
describe("sendTrailingDeskPings", () => {
  /** 23:00 ping for message one; message two at 23:10 is batched. */
  async function batchedNight() {
    const { db, shop } = await context();
    await diverWrites(NIGHT);
    const first = recorder();
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider: first.provider,
    });
    const second = new Date(NIGHT.getTime() + 10 * 60_000);
    const secondId = await diverWrites(second);
    const batched = recorder();
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: second,
      now: second,
      origin: ORIGIN,
      provider: batched.provider,
    });
    expect(batched.sent).toEqual([]);
    return { db, shop, secondId, desk: await loginsWith(["owner", "manager"]) };
  }
  const sweepAt = (minutesAfterNight: number) => {
    const { sent, provider } = recorder();
    const now = new Date(NIGHT.getTime() + minutesAfterNight * 60_000);
    return {
      sent,
      run: () => sendTrailingDeskPings(ctx.db, { now, origin: ORIGIN, provider }),
    };
  };

  it("catches up once the clock runs out, naming everyone still waiting", async () => {
    const { desk } = await batchedNight();
    const sweep = sweepAt(45);
    const outcome = await sweep.run();
    expect(sweep.sent.map((n) => n.to).sort()).toEqual(desk.map((row) => row.email).sort());
    expect(outcome).toMatchObject({ sent: desk.length, failed: 0 });
    const [ping] = sweep.sent;
    if (ping?.kind !== "desk_after_hours") throw new Error("wrong kind");
    expect(ping.waiting).toBe(2);
  });

  it("sends the catch-up once, however many passes run", async () => {
    await batchedNight();
    await sweepAt(45).run();
    const again = sweepAt(80);
    await again.run();
    expect(again.sent).toEqual([]);
  });

  it("waits while the clock is still running", async () => {
    await batchedNight();
    const early = sweepAt(20);
    await early.run();
    expect(early.sent).toEqual([]);
  });

  it("says nothing when the later message was answered, or nothing came after the ping", async () => {
    const { db, shop, secondId } = await batchedNight();
    await markInboundAnswered(db, shop.id, secondId, new Date(NIGHT.getTime() + 15 * 60_000));
    const sweep = sweepAt(45);
    await sweep.run();
    expect(sweep.sent).toEqual([]);
  });

  it("never catches up on a message that could not have pinged by itself", async () => {
    const { db, shop } = await context();
    await diverWrites(NIGHT);
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider: recorder().provider,
    });
    const soon = new Date(NIGHT.getTime() + 10 * 60_000);
    await diverWrites(soon, "spoofed@example.com", { senderAuthenticated: false });
    await diverWrites(soon, "junk@example.com", { spamFlagged: true });
    const sweep = sweepAt(45);
    await sweep.run();
    expect(sweep.sent).toEqual([]);
  });

  it("leaves it to the desk once the desk has opened", async () => {
    await batchedNight();
    // 08:30 the next morning, local: the Inbox is in front of somebody.
    const sweep = sweepAt(9 * 60 + 30);
    await sweep.run();
    expect(sweep.sent).toEqual([]);
  });

  /**
   * **Another shop's mail never pages this shop's staff** (security review
   * of #2311). The sweep's "owed" test correlates a staffer's clock with
   * messages; if it ever lost the shop, a diver writing to shop B would
   * page shop A's owner. And the reverse still holds: A's own late message
   * pings A.
   */
  it("never catches up on another shop's message, and still does on its own", async () => {
    const { db, shop } = await context();
    await diverWrites(NIGHT);
    await pingDeskAfterHours(db, {
      shopId: shop.id,
      receivedAt: NIGHT,
      now: NIGHT,
      origin: ORIGIN,
      provider: recorder().provider,
    });
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Desk", slug: `other-desk-${randomUUID()}`, timezone: ZONE })
      .returning({ id: shops.id });
    if (!other) throw new Error("shop insert failed");
    const soon = new Date(NIGHT.getTime() + 10 * 60_000);
    const filed = await recordInboundMessage(db, {
      shopId: other.id,
      channel: "email",
      fromAddress: "elsewhere@example.com",
      body: "Room on Saturday?",
      receivedAt: soon,
      providerMessageId: `ses-${randomUUID()}`,
      senderAuthenticated: true,
    });
    expect(filed.status).toBe("recorded");
    const quiet = sweepAt(45);
    expect(await quiet.run()).toMatchObject({ sent: 0 });
    expect(quiet.sent).toEqual([]);

    await diverWrites(new Date(NIGHT.getTime() + 15 * 60_000));
    const owed = sweepAt(50);
    await owed.run();
    const desk = await loginsWith(["owner", "manager"]);
    expect(owed.sent.map((n) => n.to).sort()).toEqual(desk.map((row) => row.email).sort());
    for (const ping of owed.sent) {
      if (ping.kind !== "desk_after_hours") throw new Error("wrong kind");
      expect(ping.shopId).toBe(shop.id);
    }
  });

  it("never pings from a demo shop", async () => {
    const { db, shop } = await batchedNight();
    await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
    const sweep = sweepAt(45);
    await sweep.run();
    expect(sweep.sent).toEqual([]);
  });
});

describe("the staffer's own answer", () => {
  it("defaults by role and records only the signed-in staffer's own row", async () => {
    const { db, shop } = await context();
    const [owner] = await loginsWith(["owner"]);
    if (!owner) throw new Error("demo owner missing");
    expect(
      await readAfterHoursPingChoice(db, { shopId: shop.id, personId: owner.personId }),
    ).toEqual({ wanted: true, isDefault: true });
    expect(
      await setAfterHoursPingChoice(db, {
        shopId: randomUUID(),
        personId: owner.personId,
        wanted: false,
      }),
    ).toBe(false);
    expect(
      await setAfterHoursPingChoice(db, {
        shopId: shop.id,
        personId: owner.personId,
        wanted: false,
      }),
    ).toBe(true);
    expect(
      await readAfterHoursPingChoice(db, { shopId: shop.id, personId: owner.personId }),
    ).toEqual({ wanted: false, isDefault: false });
  });
});

describe("the shop's desk hours", () => {
  it("refuses a window the schema cannot hold", async () => {
    const { db, shop } = await context();
    await expect(
      setShopDeskHours(db, shop.id, { opensMinute: 18 * 60, closesMinute: 8 * 60 }),
    ).rejects.toThrow();
  });

  it("stamps the hours as the shop's own once saved, which is what lets the footer print them", async () => {
    const { db, shop } = await context();
    const at = new Date("2026-10-12T14:00:00.000Z");
    await setShopDeskHours(db, shop.id, { opensMinute: 7 * 60, closesMinute: 17 * 60 }, at);
    const [row] = await db
      .select({ confirmedAt: shops.deskHoursConfirmedAt, opens: shops.deskOpensMinute })
      .from(shops)
      .where(eq(shops.id, shop.id));
    expect(row).toEqual({ confirmedAt: at, opens: 7 * 60 });
  });
});
