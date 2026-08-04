import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { recipientLocale } from "@/lib/notifications/kinds";
import { sendWebPush, type WebPushTarget, webPushConfig } from "@/lib/notifications/web-push";
import type { AppDb } from "./client";
import { people, pushSubscriptions, shops, trips } from "./schema";

/**
 * Who gets woken when a trip's roll call changes, and how often (ADR
 * 20260804-manifest-web-push).
 *
 * Two throttles live here, both in SQL rather than in process memory — a
 * serverless invocation does not survive long enough to remember anything:
 *
 * - **Coalescing.** At most one push per subscription per COALESCE_WINDOW_MS,
 *   so a burst of roll-call writes collapses into one notification instead of
 *   one per write. Enforced by `last_pushed_at`, and claimed with the same
 *   UPDATE that selects, so two concurrent writes cannot both decide to push.
 * - **Departure window.** A subscription is only live from
 *   WINDOW_BEFORE_MS before its trip departs until WINDOW_AFTER_MS after, read
 *   off the denormalized `trip_starts_at`. Next week's trip is never selected.
 */

/** One push per device per minute, however many roll-call writes land inside it. */
export const COALESCE_WINDOW_MS = 60_000;
/**
 * Caps on how many rows one person, and one trip, may accumulate.
 *
 * Not tidiness — a bound on the work a roll-call write can be made to do. The
 * fan-out below is awaited inside `publishManifestEvent`, so every row is an
 * outbound HTTPS request standing between a captain's "Boarded" tap and its
 * response. Without a cap, any staff account could insert unbounded rows (each
 * new endpoint is a new row under the `(endpoint, trip_id)` unique index) and
 * turn every subsequent tap into thousands of third-party requests. A person
 * realistically has a phone and maybe a tablet; a boat crew is not fifty
 * devices.
 */
export const MAX_SUBSCRIPTIONS_PER_PERSON_TRIP = 5;
export const MAX_SUBSCRIPTIONS_PER_TRIP = 50;
/**
 * Ceiling on one fan-out, independent of the caps above, so a claim can never
 * expand without bound even if rows arrive some other way.
 */
export const MAX_PUSH_TARGETS_PER_EVENT = 50;
/** Sends run in chunks of this size rather than all at once — see `pushManifestChanged`. */
export const PUSH_SEND_CONCURRENCY = 10;
/** Push from six hours ahead of departure — the morning of, not the week before. */
export const WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000;
/** …until twelve hours after, so a late-running day still reaches the boat. */
export const WINDOW_AFTER_MS = 12 * 60 * 60 * 1000;

export interface SavePushSubscriptionInput {
  shopId: string;
  tripId: string;
  personId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Upsert one device's subscription to one trip. Re-subscribing is normal — a
 * browser can rotate an endpoint at any time, and the opt-in control is
 * idempotent by design — so this updates in place rather than accumulating
 * rows that would each push the same phone.
 *
 * Returns a code, never a sentence: `not_found` when the trip does not belong
 * to this shop, which is also the tenant check. The trip's own `startsAt` is
 * copied onto the row here, which is the only place it is read.
 */
export async function savePushSubscription(
  db: AppDb,
  input: SavePushSubscriptionInput,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "too_many" }> {
  const [trip] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
    .limit(1);
  if (!trip) return { ok: false, reason: "not_found" };

  // Counted before inserting, and skipped when this endpoint already has a row
  // (that path is an update, not growth). Bounds the fan-out's work — see the
  // MAX_SUBSCRIPTIONS_* docblock.
  const [existing] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.tripId, input.tripId),
        eq(pushSubscriptions.endpoint, input.endpoint),
      ),
    )
    .limit(1);
  if (!existing) {
    const [counts] = await db
      .select({
        forTrip: sql<number>`count(*)::int`,
        forPerson: sql<number>`count(*) filter (where ${pushSubscriptions.personId} = ${input.personId})::int`,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.tripId, input.tripId));
    if (
      (counts?.forTrip ?? 0) >= MAX_SUBSCRIPTIONS_PER_TRIP ||
      (counts?.forPerson ?? 0) >= MAX_SUBSCRIPTIONS_PER_PERSON_TRIP
    ) {
      return { ok: false, reason: "too_many" };
    }
  }

  await db
    .insert(pushSubscriptions)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      personId: input.personId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      tripStartsAt: trip.startsAt,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.endpoint, pushSubscriptions.tripId],
      set: {
        p256dh: input.p256dh,
        auth: input.auth,
        personId: input.personId,
        tripStartsAt: trip.startsAt,
        // Re-subscribing does not earn an immediate extra push: leaving
        // last_pushed_at alone keeps the coalescing window intact across a
        // rotation, so a device that reconnects repeatedly cannot be used to
        // bypass the throttle.
      },
    });
  return { ok: true };
}

/**
 * Drop one device's subscription. Scoped by shop as well as endpoint so one
 * shop's staff can never delete another's row by presenting its endpoint.
 */
export async function deletePushSubscription(
  db: AppDb,
  shopId: string,
  tripId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.shopId, shopId),
        eq(pushSubscriptions.tripId, tripId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
}

/**
 * Claim the subscriptions due a push for this trip, marking them pushed in the
 * same statement.
 *
 * Claim-by-UPDATE rather than select-then-update on purpose: roll-call writes
 * are concurrent, and two of them reading the same "due" set would both send,
 * which is exactly the burst the coalescing window exists to prevent. Returning
 * the claimed rows makes the throttle atomic.
 */
export async function claimDuePushTargets(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
): Promise<(WebPushTarget & { id: string; personId: string })[]> {
  const coalesceCutoff = new Date(now.getTime() - COALESCE_WINDOW_MS);
  const windowOpens = new Date(now.getTime() + WINDOW_BEFORE_MS);
  const windowCloses = new Date(now.getTime() - WINDOW_AFTER_MS);

  const claimed = await db
    .update(pushSubscriptions)
    .set({ lastPushedAt: now })
    .where(
      and(
        eq(pushSubscriptions.shopId, shopId),
        eq(pushSubscriptions.tripId, tripId),
        // Coalescing: never pushed, or last pushed outside the window.
        or(
          isNull(pushSubscriptions.lastPushedAt),
          lt(pushSubscriptions.lastPushedAt, coalesceCutoff),
        ),
        // Departure window: departs within WINDOW_BEFORE_MS, and not longer
        // than WINDOW_AFTER_MS ago.
        lte(pushSubscriptions.tripStartsAt, windowOpens),
        gt(pushSubscriptions.tripStartsAt, windowCloses),
        // Belt to the caps' braces: even if rows arrive by some path that does
        // not go through savePushSubscription, one event can never claim more
        // than this. Ordering is unspecified and deliberately so — this is a
        // safety ceiling, not a fairness queue.
        sql`${pushSubscriptions.id} in (
          select id from ${pushSubscriptions}
          where ${pushSubscriptions.tripId} = ${tripId}
          limit ${MAX_PUSH_TARGETS_PER_EVENT}
        )`,
      ),
    )
    .returning({
      id: pushSubscriptions.id,
      personId: pushSubscriptions.personId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    });
  return claimed;
}

/**
 * Delete by primary key — used when the push service reports an endpoint gone.
 *
 * Takes `shopId` and names it in the `where` even though today's only caller
 * passes ids it just claimed under that same shop. An exported function that
 * deletes by bare id is a cross-tenant delete primitive waiting for its second
 * caller; the predicate costs nothing and means this cannot become one.
 */
export async function deletePushSubscriptionsById(
  db: AppDb,
  shopId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.shopId, shopId), inArray(pushSubscriptions.id, ids)));
}

/**
 * Fan out one "this trip's roll call changed" push.
 *
 * Best-effort throughout, and never throws: this runs off the back of a
 * roll-call write, and a push service being slow or down must never fail the
 * write that a captain is standing on the dock waiting for. Endpoints the push
 * service reports as gone are deleted on sight, which is the only pruning the
 * common case needs.
 */
export async function pushManifestChanged(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
): Promise<void> {
  try {
    const config = webPushConfig();
    if (!config) return;
    const targets = await claimDuePushTargets(db, shopId, tripId, now);
    if (targets.length === 0) return;

    // Words are resolved here, not in the service worker: that file is static,
    // cannot reach a message bundle, and no user-facing string may live outside
    // src/i18n. Each device gets its own reader's locale, per ADR
    // 20260731-per-person-notification-locale — the same
    // person-then-shop-default fallback every other notification uses.
    const [shop] = await db
      .select({ slug: shops.slug, defaultLocale: shops.defaultLocale })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return;
    const localeRows = await db
      .select({ id: people.id, locale: people.locale })
      .from(people)
      // Shop-scoped like every other query here, though the ids come from rows
      // already claimed under this shop: this is the one read in the fan-out
      // whose `where` would otherwise not name the tenant.
      .where(
        and(
          eq(people.shopId, shopId),
          inArray(
            people.id,
            targets.map((target) => target.personId),
          ),
        ),
      );
    const localeByPerson = new Map(localeRows.map((row) => [row.id, row.locale]));
    const url = `/shop/${shop.slug}/trips/${tripId}/manifest`;

    // Chunked rather than one big `Promise.all`: every in-flight send is an
    // open socket, and this runs inside a roll-call write. A bounded number of
    // concurrent requests keeps the worst case proportional to the chunk size
    // rather than to the number of subscribers.
    const gone: string[] = [];
    for (let index = 0; index < targets.length; index += PUSH_SEND_CONCURRENCY) {
      const chunk = targets.slice(index, index + PUSH_SEND_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (target) => {
          const t = staffTranslator(
            recipientLocale(localeByPerson.get(target.personId), shop.defaultLocale),
          );
          return {
            id: target.id,
            result: await sendWebPush(
              target,
              {
                kind: "manifest-changed",
                tripId,
                url,
                title: t("trips.offlineManifestManager.pushNotificationTitle"),
                body: t("trips.offlineManifestManager.pushNotificationBody"),
              },
              config,
            ),
          };
        }),
      );
      for (const entry of results) if (entry.result.status === "gone") gone.push(entry.id);
    }
    await deletePushSubscriptionsById(db, shopId, gone);
  } catch {
    // Best-effort by design — see the docblock.
  }
}
