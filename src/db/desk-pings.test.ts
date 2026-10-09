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

async function diverWrites(at: Date, from = `diver-${randomUUID()}@example.com`) {
  const { db, shop } = ctx;
  const result = await recordInboundMessage(db, {
    shopId: shop.id,
    channel: "email",
    fromAddress: from,
    subject: "Night dive?",
    body: "Is there room on Saturday’s night dive? My cert is in my bag.",
    receivedAt: at,
    providerMessageId: `ses-${randomUUID()}`,
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
});
