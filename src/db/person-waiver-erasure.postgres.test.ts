import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { NotificationProvider } from "@/lib/notifications";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { drainNotificationRetries } from "./notifications";
import {
  notificationSendQueue,
  people,
  personRoles,
  shops,
  waiverDeliveries,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { issueAndDeliverPersonWaiver } from "./waiver-issue";

async function fixture(pg: Awaited<ReturnType<typeof postgresTestDb>>, suffix: string) {
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: `Person waiver ${suffix}`, slug: `person-waiver-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const [person] = await pg.db
    .insert(people)
    .values({
      shopId: shop.id,
      fullName: "Unscheduled Diver",
      email: `person-${suffix}@example.org`,
    })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  const [owner] = await pg.db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Shop Owner", email: `owner-${suffix}@example.org` })
    .returning();
  if (!owner) throw new Error("owner insert returned no row");
  await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
  await pg.db.execute(
    sql`insert into user_accounts (person_id, email) values (${owner.id}, ${owner.email})`,
  );
  await pg.db
    .insert(waiverTemplates)
    .values({ shopId: shop.id, title: "Release", version: 1, body: "Release terms." });
  return { shop, person, owner };
}

function provider(send: NotificationProvider["send"]) {
  return { send } satisfies NotificationProvider;
}

async function erase(
  pg: Awaited<ReturnType<typeof postgresTestDb>>,
  input: {
    shopId: string;
    personId: string;
    ownerId: string;
  },
) {
  return anonymizeDiver(pg.db, {
    shopId: input.shopId,
    personId: input.personId,
    actorPersonId: input.ownerId,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describePostgres("person-scoped waiver send and erasure fence", () => {
  it("sends and records an independent waiver through its person fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person } = await fixture(pg, suffix);
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const send = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "sent",
      providerMessageId: `person-waiver-${suffix}`,
    }));

    const result = await issueAndDeliverPersonWaiver(pg.db, shop.id, person.id, {
      provider: provider(send),
    });

    expect(result).toMatchObject({ ok: true, bookingId: null, delivery: "sent" });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ kind: "waiver_request", to: person.email });
    expect(
      await pg.db
        .select()
        .from(waiverRecords)
        .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.personId, person.id))),
    ).toHaveLength(1);
    expect(
      await pg.db.select().from(waiverDeliveries).where(eq(waiverDeliveries.shopId, shop.id)),
    ).toHaveLength(1);
  });

  it("suppresses issuance when erasure wins before the send fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person } = await fixture(pg, suffix);
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const erasedAt = new Date(nowDate().getTime() + 1);
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (acquired = resolve));
    const erasureDb = pg.connect();
    const erasure = erasureDb.transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shop.id, "rewrite");
      await tx
        .update(people)
        .set({ anonymizedAt: erasedAt, deletedAt: erasedAt })
        .where(eq(people.id, person.id));
      acquired();
      await gate;
    });
    const send = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "sent",
      providerMessageId: "unexpected",
    }));
    let issue: ReturnType<typeof issueAndDeliverPersonWaiver> | undefined;
    try {
      await started;
      issue = issueAndDeliverPersonWaiver(pg.db, shop.id, person.id, { provider: provider(send) });
      await waitForLockWaiters(pg.db, 1);
      release();
      await erasure;
      await expect(issue).resolves.toMatchObject({ ok: false, reason: "error" });
      expect(send).not.toHaveBeenCalled();
      expect(await pg.db.select().from(waiverRecords)).toHaveLength(0);
      expect(await pg.db.select().from(waiverDeliveries)).toHaveLength(0);
    } finally {
      release();
      await erasure.catch(() => undefined);
      await issue?.catch(() => undefined);
    }
  });

  it("lets erasure wait for an entered provider, then scrubs its tracking", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, owner } = await fixture(pg, suffix);
    vi.stubEnv("APP_HOST", "https://diveday.example");
    let release!: () => void;
    let entered!: () => void;
    const providerGate = new Promise<void>((resolve) => (release = resolve));
    const providerStarted = new Promise<void>((resolve) => (entered = resolve));
    const send = vi.fn<NotificationProvider["send"]>(async () => {
      entered();
      await providerGate;
      return { status: "sent", providerMessageId: `held-${suffix}` };
    });
    const issue = issueAndDeliverPersonWaiver(pg.db, shop.id, person.id, {
      provider: provider(send),
    });
    let erasure: ReturnType<typeof erase> | undefined;
    try {
      await providerStarted;
      erasure = erase(pg, { shopId: shop.id, personId: person.id, ownerId: owner.id });
      await waitForLockWaiters(pg.db, 1);
      release();
      await expect(issue).resolves.toMatchObject({ ok: true, delivery: "sent" });
      await expect(erasure).resolves.toMatchObject({ ok: true });
      const [scrubbed] = await pg.db.select().from(people).where(eq(people.id, person.id));
      expect(scrubbed?.anonymizedAt).not.toBeNull();
      expect(await pg.db.select().from(notificationSendQueue)).toHaveLength(0);
      const deliveries = await pg.db
        .select({ detail: waiverDeliveries.detail })
        .from(waiverDeliveries)
        .where(eq(waiverDeliveries.shopId, shop.id));
      expect(deliveries).toEqual([{ detail: null }]);
    } finally {
      release();
      await issue.catch(() => undefined);
      await erasure?.catch(() => undefined);
    }
  });

  it("binds a person-waiver retry and suppresses it when erasure wins before dispatch", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, owner } = await fixture(pg, suffix);
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const first = await issueAndDeliverPersonWaiver(pg.db, shop.id, person.id, {
      provider: provider(async () => ({
        status: "failed",
        retryable: true,
        errorCode: "temporary",
      })),
    });
    expect(first).toMatchObject({ ok: true, delivery: "failed" });
    const [queued] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.shopId, shop.id));
    expect(queued?.recipientPersonId).toBe(person.id);
    const erased = await erase(pg, { shopId: shop.id, personId: person.id, ownerId: owner.id });
    expect(erased).toMatchObject({ ok: true });

    const retry = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "sent",
      providerMessageId: "unexpected",
    }));
    const summary = await drainNotificationRetries(pg.db, {
      now: new Date(nowDate().getTime() + 2 * 24 * 60 * 60 * 1000),
      provider: provider(retry),
    });
    expect(summary.failed).toBe(0);
    expect(retry).not.toHaveBeenCalled();
    expect(await pg.db.select().from(notificationSendQueue)).toHaveLength(0);
  });

  it("holds erasure behind an entered person-waiver retry, then scrubs its tracking", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, owner } = await fixture(pg, suffix);
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    await issueAndDeliverPersonWaiver(pg.db, shop.id, person.id, {
      provider: provider(async () => ({
        status: "failed",
        retryable: true,
        errorCode: "temporary",
      })),
    });

    let release!: () => void;
    let entered!: () => void;
    const providerGate = new Promise<void>((resolve) => (release = resolve));
    const providerStarted = new Promise<void>((resolve) => (entered = resolve));
    const retryProvider = vi.fn<NotificationProvider["send"]>(async () => {
      entered();
      await providerGate;
      return { status: "sent", providerMessageId: `retry-${suffix}` };
    });
    const drain = drainNotificationRetries(pg.db, {
      now: new Date(nowDate().getTime() + 2 * 24 * 60 * 60 * 1000),
      provider: provider(retryProvider),
    });
    let erasure: ReturnType<typeof erase> | undefined;
    try {
      await providerStarted;
      erasure = erase(pg, { shopId: shop.id, personId: person.id, ownerId: owner.id });
      await waitForLockWaiters(pg.db, 1);
      release();
      await expect(drain).resolves.toMatchObject({ failed: 1 });
      await expect(erasure).resolves.toMatchObject({ ok: true });
      expect(retryProvider).toHaveBeenCalledOnce();
      expect(await pg.db.select().from(notificationSendQueue)).toHaveLength(0);
      const deliveries = await pg.db
        .select({ detail: waiverDeliveries.detail })
        .from(waiverDeliveries)
        .where(eq(waiverDeliveries.shopId, shop.id));
      expect(deliveries).toEqual([{ detail: null }]);
    } finally {
      release();
      await drain.catch(() => undefined);
      await erasure?.catch(() => undefined);
    }
  });

  it("parks an existing unbound person-waiver retry without dispatching it", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person } = await fixture(pg, suffix);
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    await issueAndDeliverPersonWaiver(pg.db, shop.id, person.id, {
      provider: provider(async () => ({
        status: "failed",
        retryable: true,
        errorCode: "temporary",
      })),
    });
    await pg.db.update(notificationSendQueue).set({ recipientPersonId: null });

    const retry = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "sent",
      providerMessageId: "unexpected",
    }));
    const summary = await drainNotificationRetries(pg.db, {
      now: new Date(nowDate().getTime() + 2 * 24 * 60 * 60 * 1000),
      provider: provider(retry),
    });

    expect(summary.failed).toBe(1);
    expect(retry).not.toHaveBeenCalled();
    const [parked] = await pg.db.select().from(notificationSendQueue);
    expect(parked).toMatchObject({ status: "failed", errorCode: "retry_subject_unbound" });
    expect(parked?.payloadSealed).toBeTruthy();
  });
});
