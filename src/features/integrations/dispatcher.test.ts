import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { enqueueOrderIntegrationEvent } from "@/db/integration-events";
import { saveShopIntegration } from "@/db/integrations";
import { integrationDeliveries, orders, shopIntegrations } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { dispatchDueIntegrationDeliveries } from "./dispatcher";

const HOOK = "https://hooks.zapier.com/hooks/catch/123456/abcdef";

function jsonResponse(status: number) {
  return new Response(status === 204 ? null : "{}", { status });
}

async function connectZapier(db: AppDb, shopId: string) {
  return saveShopIntegration(db, {
    shopId,
    provider: "zapier",
    credentials: { webhookUrl: HOOK },
    settings: { eventTypes: ["order.paid"] },
  });
}

/** A real seeded order, so the payload is the one production would build. */
async function queueOrderPaid(db: AppDb, shopId: string, key: string) {
  const [order] = await db.select().from(orders).where(eq(orders.shopId, shopId)).limit(1);
  if (!order) throw new Error("expected a seeded order");
  const event = await enqueueOrderIntegrationEvent(db, {
    shopId,
    orderId: order.id,
    eventType: "order.paid",
    idempotencyKey: key,
  });
  if (!event) throw new Error("expected an enqueued event");
  // `next_attempt_at` is stamped by Postgres' clock, which `DIVEDAY_CLOCK` does
  // not freeze — so a freshly queued row is due in the *future* as far as the
  // dispatcher's own `nowDate()` is concerned, and nothing would ever be
  // scanned. See the `dbNow` docblock in src/test/db.ts for the general shape
  // of this trap. Stamping it against the application clock is the fix, not a
  // sleep: the comparison is then exact.
  const [delivery] = await db
    .update(integrationDeliveries)
    .set({ nextAttemptAt: new Date(nowMs() - 1_000) })
    .where(eq(integrationDeliveries.eventId, event.id))
    .returning();
  if (!delivery) throw new Error("expected a queued delivery");
  return { order, event, delivery };
}

/**
 * Issue #1020: `dispatchDueIntegrationDeliveries` takes an injectable
 * `fetchImpl` specifically so it can be driven from a test, and nothing did.
 * The claim-then-deliver race, the retryable/non-retryable split, the attempt
 * ceiling and the healthy/errored flip were all uncovered.
 */
describe("dispatchDueIntegrationDeliveries", () => {
  it("delivers a due event and marks the integration healthy", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const integration = await connectZapier(db, shop.id);
    const { delivery } = await queueOrderPaid(db, shop.id, "order:paid:1");
    const fetchImpl = vi.fn(async () => jsonResponse(200));

    const summary = await dispatchDueIntegrationDeliveries(db, { fetchImpl });

    expect(summary).toMatchObject({ scanned: 1, delivered: 1, retried: 0, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [after] = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.id, delivery.id));
    expect(after?.status).toBe("delivered");
    expect(after?.deliveredAt).not.toBeNull();
    const [row] = await db
      .select()
      .from(shopIntegrations)
      .where(eq(shopIntegrations.id, integration.id));
    expect(row?.status).toBe("connected");
    expect(row?.lastSyncedAt).not.toBeNull();
  });

  it("schedules a retry on a retryable failure and leaves the connection healthy", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const integration = await connectZapier(db, shop.id);
    const { delivery } = await queueOrderPaid(db, shop.id, "order:paid:2");

    const summary = await dispatchDueIntegrationDeliveries(db, {
      fetchImpl: vi.fn(async () => jsonResponse(503)),
    });

    expect(summary).toMatchObject({ delivered: 0, retried: 1, failed: 0 });
    const [after] = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.id, delivery.id));
    expect(after?.status).toBe("pending");
    expect(after?.attemptCount).toBe(1);
    expect(after?.lastError).toBe("zapier_hook_refused");
    const [row] = await db
      .select()
      .from(shopIntegrations)
      .where(eq(shopIntegrations.id, integration.id));
    expect(row?.status).toBe("connected");
  });

  it("errors the integration on a refusal it will never outgrow", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const integration = await connectZapier(db, shop.id);
    const { delivery } = await queueOrderPaid(db, shop.id, "order:paid:3");

    const summary = await dispatchDueIntegrationDeliveries(db, {
      fetchImpl: vi.fn(async () => jsonResponse(404)),
    });

    expect(summary).toMatchObject({ delivered: 0, retried: 0, failed: 1 });
    const [after] = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.id, delivery.id));
    expect(after?.status).toBe("failed");
    const [row] = await db
      .select()
      .from(shopIntegrations)
      .where(eq(shopIntegrations.id, integration.id));
    expect(row?.status).toBe("error");
    expect(row?.lastError).toBe("zapier_hook_not_found");
  });

  it("stops trying at the attempt ceiling", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await connectZapier(db, shop.id);
    const { delivery } = await queueOrderPaid(db, shop.id, "order:paid:4");
    await db
      .update(integrationDeliveries)
      .set({ attemptCount: 7 })
      .where(eq(integrationDeliveries.id, delivery.id));

    const summary = await dispatchDueIntegrationDeliveries(db, {
      fetchImpl: vi.fn(async () => jsonResponse(503)),
    });

    expect(summary).toMatchObject({ retried: 0, failed: 1 });
    const [after] = await db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.id, delivery.id));
    expect(after?.attemptCount).toBe(8);
    expect(after?.status).toBe("failed");
    // And the next pass does not even see it.
    expect(
      await dispatchDueIntegrationDeliveries(db, { fetchImpl: vi.fn(async () => jsonResponse(200)) }),
    ).toMatchObject({ scanned: 0 });
  });

  /**
   * The claim is a conditional update precisely so two cron workers that both
   * selected the same row cannot both send it. Running two passes concurrently
   * is the closest a single-connection test gets to that race, and it fails if
   * the claim is relaxed into an unconditional update.
   */
  it("sends one delivery once, even when two passes overlap", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await connectZapier(db, shop.id);
    await queueOrderPaid(db, shop.id, "order:paid:5");
    const fetchImpl = vi.fn(async () => jsonResponse(200));

    const [first, second] = await Promise.all([
      dispatchDueIntegrationDeliveries(db, { fetchImpl }),
      dispatchDueIntegrationDeliveries(db, { fetchImpl }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.delivered + second.delivered).toBe(1);
  });

  it("does not drain a provider the shop disconnected", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await connectZapier(db, shop.id);
    await queueOrderPaid(db, shop.id, "order:paid:6");
    await db
      .update(shopIntegrations)
      .set({ deletedAt: new Date() })
      .where(eq(shopIntegrations.shopId, shop.id));
    const fetchImpl = vi.fn(async () => jsonResponse(200));

    expect(await dispatchDueIntegrationDeliveries(db, { fetchImpl })).toMatchObject({ scanned: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /**
   * Issue #1016. The stored payload names the customer by id and nothing else;
   * the name and email are read at the moment of sending. Assert both halves —
   * that the row holds no identity, and that the delivery still carries one.
   */
  it("sends the diver's name without ever storing it", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    await connectZapier(db, shop.id);
    const { event } = await queueOrderPaid(db, shop.id, "order:paid:7");

    expect(event.payload.customer).toEqual({ id: expect.any(String) });
    expect(JSON.stringify(event.payload)).not.toMatch(/@/);

    let sent: Record<string, unknown> | null = null;
    await dispatchDueIntegrationDeliveries(db, {
      fetchImpl: vi.fn(async (_url: unknown, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse(200);
      }) as unknown as typeof fetch,
    });

    const delivered = (sent as unknown as { data: { customer: Record<string, unknown> } } | null)
      ?.data.customer;
    expect(delivered?.name).toEqual(expect.any(String));
    expect(String(delivered?.name).length).toBeGreaterThan(0);
  });
});
