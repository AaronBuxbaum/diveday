import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import {
  checkoutPaidKey,
  checkoutRefundKey,
  enqueueCheckoutIntegrationEvent,
  enqueueTipIntegrationEvent,
  eventIsSubscribed,
  tipPaidKey,
} from "./integration-events";
import {
  bookingCheckouts,
  bookings,
  integrationDeliveries,
  integrationEvents,
  type ShopIntegration,
  shopIntegrations,
  tips,
  trips,
} from "./schema";
import { notRehearsal } from "./trips-live";

/**
 * **"Send earlier checkouts"** (issue #2606, ADR
 * 20261014-checkouts-reach-integrations): an owner chooses one connected
 * integration and a start date, and the checkouts, tips and checkout refunds
 * completed since then that this provider has never been handed go through the
 * ordinary delivery queue, oldest first.
 *
 * **Why a second run, and an overlap with live events, send nothing twice.**
 * Three layers, each enough on its own for a different failure:
 *  - a candidate is skipped when any delivery of its event already exists for
 *    this shop's integration of this provider (a reconnect makes a new
 *    `shop_integrations` row, so the test is by provider, not by row id);
 *  - the event is enqueued under the *same* idempotency key the live path
 *    writes (`checkoutPaidKey`, `checkoutRefundKey`, `tipPaidKey`), so an
 *    event the live path already wrote is reused, never duplicated;
 *  - `integration_deliveries` is unique on `(integration_id, event_id)`.
 *
 * **Scoped to the shop at every read**: the integration is looked up by
 * `(shop_id, id)` and every candidate query carries the shop. **Fan-out is to
 * the chosen integration only**: another provider with a period of its own
 * closed hears nothing.
 *
 * A refund is one event at the checkout's running refunded total, the key the
 * live path would have written for the last refund, so a shop whose last
 * refund already went out is not sent it again.
 */

/** One run sends at most this many events; the owner runs it again for the rest. */
export const BACKFILL_MAX_PER_RUN = 500;
const CHUNK = 100;

export type BackfillCounts = { checkouts: number; tips: number; refunds: number };

type Candidate =
  | { kind: "checkout"; id: string; at: Date }
  | { kind: "refund"; id: string; at: Date; refundedCents: number }
  | { kind: "tip"; id: string; at: Date };

const KIND_ORDER = { checkout: 0, refund: 1, tip: 2 } as const;

function eventKey(candidate: Candidate): string {
  if (candidate.kind === "checkout") return checkoutPaidKey(candidate.id);
  if (candidate.kind === "refund") return checkoutRefundKey(candidate.id, candidate.refundedCents);
  return tipPaidKey(candidate.id);
}

/** The integration the owner chose, only if it is this shop's, live and connected. */
async function chosenIntegration(db: DbExecutor, shopId: string, integrationId: string) {
  const [row] = await db
    .select()
    .from(shopIntegrations)
    .where(
      and(
        eq(shopIntegrations.shopId, shopId),
        eq(shopIntegrations.id, integrationId),
        eq(shopIntegrations.status, "connected"),
        isNull(shopIntegrations.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function candidatesSince(db: DbExecutor, shopId: string, since: Date): Promise<Candidate[]> {
  const checkouts = await db
    .select({
      id: bookingCheckouts.id,
      completedAt: bookingCheckouts.completedAt,
      refundedCents: bookingCheckouts.refundedCents,
    })
    .from(bookingCheckouts)
    // diveday:allow-rehearsal: filtered by `notRehearsal()` below; a rehearsal's checkout never reaches an integration.
    .innerJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(bookingCheckouts.shopId, shopId),
        eq(bookingCheckouts.status, "completed"),
        gte(bookingCheckouts.completedAt, since),
        notRehearsal(),
      ),
    )
    // diveday:allow-time-id-order: a queue order nobody is shown; the candidates are re-sorted by instant and kind below.
    .orderBy(asc(bookingCheckouts.completedAt), asc(bookingCheckouts.id));
  const paidTips = await db
    .select({ id: tips.id, completedAt: tips.completedAt })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, shopId)))
    // diveday:allow-rehearsal: filtered by `notRehearsal()` below; a rehearsal's tip never reaches an integration.
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(tips.shopId, shopId),
        eq(tips.status, "paid"),
        gte(tips.completedAt, since),
        notRehearsal(),
      ),
    )
    // diveday:allow-time-id-order: a queue order nobody is shown; the candidates are re-sorted by instant and kind below.
    .orderBy(asc(tips.completedAt), asc(tips.id));

  const found: Candidate[] = [];
  for (const row of checkouts) {
    if (!row.completedAt) continue;
    found.push({ kind: "checkout", id: row.id, at: row.completedAt });
    if (row.refundedCents > 0) {
      found.push({
        kind: "refund",
        id: row.id,
        at: row.completedAt,
        refundedCents: row.refundedCents,
      });
    }
  }
  for (const row of paidTips) {
    if (row.completedAt) found.push({ kind: "tip", id: row.id, at: row.completedAt });
  }
  return found.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.id.localeCompare(b.id),
  );
}

/** Candidates this provider has not been handed and is subscribed to hear about. */
async function unsentFor(
  db: DbExecutor,
  shopId: string,
  integration: { provider: ShopIntegration["provider"]; settings: unknown },
  all: Candidate[],
): Promise<Candidate[]> {
  const wanted = all.filter((candidate) =>
    eventIsSubscribed(
      integration.settings,
      candidate.kind === "refund" ? "order.refunded" : "order.paid",
    ),
  );
  const handed = new Set<string>();
  for (let i = 0; i < wanted.length; i += 500) {
    const keys = wanted.slice(i, i + 500).map(eventKey);
    const rows = await db
      .select({ key: integrationEvents.idempotencyKey })
      .from(integrationEvents)
      .innerJoin(integrationDeliveries, eq(integrationDeliveries.eventId, integrationEvents.id))
      .innerJoin(
        shopIntegrations,
        and(
          eq(shopIntegrations.id, integrationDeliveries.integrationId),
          eq(shopIntegrations.shopId, shopId),
          eq(shopIntegrations.provider, integration.provider),
        ),
      )
      .where(
        and(eq(integrationEvents.shopId, shopId), inArray(integrationEvents.idempotencyKey, keys)),
      );
    for (const row of rows) handed.add(row.key);
  }
  return wanted.filter((candidate) => !handed.has(eventKey(candidate)));
}

function countOf(candidates: Candidate[]): BackfillCounts {
  return {
    checkouts: candidates.filter((c) => c.kind === "checkout").length,
    tips: candidates.filter((c) => c.kind === "tip").length,
    refunds: candidates.filter((c) => c.kind === "refund").length,
  };
}

export type BackfillPreview =
  | { ok: true; provider: string; counts: BackfillCounts }
  | { ok: false; reason: "integration_unavailable" };

/** What a run would send: counts only, nothing written. */
export async function previewIntegrationBackfill(
  db: DbExecutor,
  input: { shopId: string; integrationId: string; since: Date },
): Promise<BackfillPreview> {
  const integration = await chosenIntegration(db, input.shopId, input.integrationId);
  if (!integration) return { ok: false, reason: "integration_unavailable" };
  const pending = await unsentFor(
    db,
    input.shopId,
    integration,
    await candidatesSince(db, input.shopId, input.since),
  );
  return { ok: true, provider: integration.provider, counts: countOf(pending) };
}

export type BackfillResult =
  | { ok: true; sent: BackfillCounts; remaining: number }
  | { ok: false; reason: "integration_unavailable" };

/**
 * Queue the unsent events, oldest first, at most {@link BACKFILL_MAX_PER_RUN}.
 * Each chunk is its own transaction, so a failure part-way leaves a clean
 * prefix and a re-run picks up exactly the rest.
 */
export async function runIntegrationBackfill(
  db: AppDb,
  input: { shopId: string; integrationId: string; since: Date; limit?: number },
): Promise<BackfillResult> {
  const integration = await chosenIntegration(db, input.shopId, input.integrationId);
  if (!integration) return { ok: false, reason: "integration_unavailable" };
  const pending = await unsentFor(
    db,
    input.shopId,
    integration,
    await candidatesSince(db, input.shopId, input.since),
  );
  const batch = pending.slice(0, input.limit ?? BACKFILL_MAX_PER_RUN);
  // The queue orders by `next_attempt_at`; one millisecond apiece keeps the
  // oldest sale first however the rows land.
  const base = nowDate().getTime();
  const sent: Candidate[] = [];
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      for (const [offset, candidate] of chunk.entries()) {
        const onlyIntegration = {
          id: integration.id,
          nextAttemptAt: new Date(base + i + offset),
        };
        const event =
          candidate.kind === "tip"
            ? await enqueueTipIntegrationEvent(tx, {
                shopId: input.shopId,
                tipId: candidate.id,
                onlyIntegration,
              })
            : await enqueueCheckoutIntegrationEvent(tx, {
                shopId: input.shopId,
                checkoutId: candidate.id,
                eventType: candidate.kind === "refund" ? "order.refunded" : "order.paid",
                idempotencyKey: eventKey(candidate),
                ...(candidate.kind === "refund" ? { refundCents: candidate.refundedCents } : {}),
                onlyIntegration,
              });
        if (event) sent.push(candidate);
      }
    });
  }
  return { ok: true, sent: countOf(sent), remaining: pending.length - batch.length };
}
