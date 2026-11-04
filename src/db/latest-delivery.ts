import { and, eq, gt, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbExecutor } from "./client";
import { notificationDeliveries } from "./schema";

const newer = alias(notificationDeliveries, "newer_delivery");

/**
 * True for a `notification_deliveries` row that no later send of the same
 * shop, booking and kind has superseded (issue #2728). Every row is one send, so
 * "the status of this booking's waiver link" is its newest row: a failure a
 * later success replaced is history, not an open issue.
 *
 * Newest is the later `attempted_at`, then the later `created_at`, then the
 * greater id (the shape `tripHasStandingSailedRollCall` uses), so two sends
 * stamped in the same instant still leave exactly one latest row. Use it in a
 * `where` or a join condition over the unaliased `notificationDeliveries`.
 *
 * A row a moved departure superseded (`superseded_at`, issue #3705) is the
 * record of an old date's reminder, never the latest of anything.
 */
export function latestDeliveryOnly(db: DbExecutor) {
  return and(
    isNull(notificationDeliveries.supersededAt),
    notExists(
      db
        .select({ one: sql`1` })
        .from(newer)
        .where(
          and(
            eq(newer.shopId, notificationDeliveries.shopId),
            eq(newer.bookingId, notificationDeliveries.bookingId),
            eq(newer.kind, notificationDeliveries.kind),
            or(
              gt(newer.attemptedAt, notificationDeliveries.attemptedAt),
              and(
                eq(newer.attemptedAt, notificationDeliveries.attemptedAt),
                or(
                  gt(newer.createdAt, notificationDeliveries.createdAt),
                  and(
                    eq(newer.createdAt, notificationDeliveries.createdAt),
                    gt(newer.id, notificationDeliveries.id),
                  ),
                ),
              ),
            ),
          ),
        ),
    ),
  );
}
