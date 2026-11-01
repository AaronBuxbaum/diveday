import { and, desc, eq, exists, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { staffTranslator } from "@/i18n/staff-messages";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { recipientLocale } from "@/lib/notifications/kinds";
import { sendWebPush, type WebPushTarget, webPushConfig } from "@/lib/notifications/web-push";
import { isInPushWindow } from "@/lib/push-window";
import type { AppDb } from "./client";
import {
  people,
  personRoles,
  pushSubscriptions,
  shops,
  tripScheduleDays,
  trips,
  userAccounts,
} from "./schema";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";

/**
 * Who gets woken when a trip's roll call changes, and how often (ADR
 * 20260804-manifest-web-push).
 *
 * **Coalescing** lives here, in SQL rather than in process memory — a
 * serverless invocation does not survive long enough to remember anything. At
 * most one push per subscription per COALESCE_WINDOW_MS, so a burst of
 * roll-call writes collapses into one notification instead of one per write.
 * Enforced by `last_pushed_at` and claimed with the same UPDATE that selects,
 * so two concurrent writes cannot both decide to push.
 *
 * The other throttle, the **departure window**, deliberately does not live here
 * at all: it is checked against the live trip row in `pushManifestChanged`
 * (src/lib/push-window.ts). It used to be a value copied onto the subscription
 * when someone opted in, which could not follow a trip that moved.
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
 * to this shop (which is also the tenant check), and `too_many` when the caps
 * below are already reached.
 */
export async function savePushSubscription(
  db: AppDb,
  input: SavePushSubscriptionInput,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "too_many" }> {
  const [trip] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    // A rehearsal pushes nothing, so nobody subscribes to one.
    .where(
      and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip(), notRehearsal()),
    )
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
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.endpoint, pushSubscriptions.tripId],
      set: {
        p256dh: input.p256dh,
        auth: input.auth,
        personId: input.personId,
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
): Promise<{ hasOtherTrips: boolean }> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.shopId, shopId),
        eq(pushSubscriptions.tripId, tripId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
  // Whether this device still has a row for some *other* trip. The caller uses
  // it to decide whether to tear down the browser subscription: that object is
  // origin-wide, so unsubscribing it while a second departure still expects
  // pushes would silently disable that boat too — and the row left behind would
  // POST at a dead endpoint until a 410 pruned it.
  const [remaining] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.shopId, shopId), eq(pushSubscriptions.endpoint, endpoint)))
    .limit(1);
  return { hasOtherTrips: Boolean(remaining) };
}

/**
 * Whether this exact device is subscribed to this exact trip.
 *
 * The control cannot answer this from the browser. `pushManager.getSubscription()`
 * returns one subscription per service-worker registration — it is origin-wide —
 * while a row here is per trip. A captain running two departures would otherwise
 * open the second trip's manifest, see the toggle reading "on", and have no row
 * for the boat they are about to take; worse, turning it "off" there would drop
 * the browser subscription and silently kill the first trip's push too.
 */
export async function isDeviceSubscribed(
  db: AppDb,
  shopId: string,
  tripId: string,
  endpoint: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.shopId, shopId),
        eq(pushSubscriptions.tripId, tripId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Whether this device has a row for *any* trip in this shop. */
export async function isDeviceSubscribedAnywhere(
  db: AppDb,
  shopId: string,
  endpoint: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.shopId, shopId), eq(pushSubscriptions.endpoint, endpoint)))
    .limit(1);
  return Boolean(row);
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
        // The departure window is deliberately *not* here any more: it is
        // checked against the live trip row in `pushManifestChanged` before
        // this runs. Deciding it from a value copied onto the subscription at
        // subscribe time meant a trip that moved kept its old window — see
        // src/lib/push-window.ts.
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

type PushDeliveryTarget = WebPushTarget & { id: string; personId: string };

/** Shared bounded delivery mechanics; target selection and payload policy stay with callers. */
async function sendPushTargets(
  db: AppDb,
  shopId: string,
  targets: PushDeliveryTarget[],
  localeByPerson: Map<string, string | null>,
  defaultLocale: string,
  config: NonNullable<ReturnType<typeof webPushConfig>>,
  payloadFor: (
    target: PushDeliveryTarget,
    t: ReturnType<typeof staffTranslator>,
  ) => Parameters<typeof sendWebPush>[1],
): Promise<number> {
  let sent = 0;
  const gone: string[] = [];
  for (let index = 0; index < targets.length; index += PUSH_SEND_CONCURRENCY) {
    const chunk = targets.slice(index, index + PUSH_SEND_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (target) => {
        const t = staffTranslator(
          recipientLocale(localeByPerson.get(target.personId), defaultLocale),
        );
        return {
          id: target.id,
          result: await sendWebPush(target, payloadFor(target, t), config),
        };
      }),
    );
    for (const entry of results) {
      if (entry.result.status === "sent") sent += 1;
      if (entry.result.status === "gone") gone.push(entry.id);
    }
  }
  await deletePushSubscriptionsById(db, shopId, gone);
  return sent;
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

    // The departure window, read from the trip as it stands right now rather
    // than from a copy taken when someone subscribed. `endsAt` is the later of
    // the trip's own end and its last scheduled day, so a multi-day course is
    // covered for its whole run instead of only day one.
    const [trip] = await db
      .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
      .from(trips)
      // A rehearsal pushes nothing to anyone (ADR 20261012-rehearsal-departures).
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip(), notRehearsal()))
      .limit(1);
    if (!trip) return;
    // Read as typed columns and compared in JS rather than as one `greatest(…)`
    // expression: a raw SQL cast comes back unparsed, and a string here would
    // throw inside the best-effort catch below — which is to say it would
    // disable push silently rather than loudly.
    const [lastDay] = await db
      .select({ endsAt: tripScheduleDays.endsAt })
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, tripId))
      .orderBy(desc(tripScheduleDays.endsAt))
      .limit(1);
    const endsAt =
      lastDay && lastDay.endsAt.getTime() > trip.endsAt.getTime() ? lastDay.endsAt : trip.endsAt;
    if (!isInPushWindow({ startsAt: trip.startsAt, endsAt }, now)) return;

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
      // diveday:allow-deleted-people: locales for recipients the fan-out already chose.
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
    await sendPushTargets(
      db,
      shopId,
      targets,
      localeByPerson,
      shop.defaultLocale,
      config,
      (_target, t) => ({
        kind: "manifest-changed",
        tripId,
        url,
        title: t("trips.offlineManifestManager.pushNotificationTitle"),
        body: t("trips.offlineManifestManager.pushNotificationBody"),
      }),
    );
  } catch {
    // Best-effort by design — see the docblock.
  }
}

/**
 * **One push about one departure to every device following its manifest,
 * now** — the stale-roll-call alert (batch 6, item 6;
 * src/db/roll-call-alerts.ts). Unlike {@link pushManifestChanged} it neither
 * coalesces nor asks the departure window: it is sent once per departure, by
 * a pass that has already claimed it. Same ceilings, same allowlist (inside
 * `sendWebPush`), same pruning of endpoints the push service says are gone,
 * and the same "never throws": a push service being down must not stop the
 * owner's email beside it. Words are resolved per device in its owner's
 * locale, never in the service worker. Returns how many sends went.
 *
 * **Only to staff who still are** (security review 20261014): a device is
 * pushed only while its person is live in this shop, their login is active,
 * and they hold a staff role now. A subscription outlives its follower's
 * account (a disabled login, a demotion to diver), and a push about who is
 * unaccounted for on a boat is not news for someone who has left; the
 * subscription row itself is cleared by `setStaffAccountStatus` and
 * `removeStaffMember`, and this join holds whatever path missed it.
 */
export async function pushTripAlert(
  db: AppDb,
  shopId: string,
  tripId: string,
  message: {
    url: string;
    words: (t: ReturnType<typeof staffTranslator>) => { title: string; body: string };
  },
): Promise<number> {
  try {
    const config = webPushConfig();
    if (!config) return 0;
    const targets = await db
      .select({
        id: pushSubscriptions.id,
        personId: pushSubscriptions.personId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .innerJoin(
        people,
        and(eq(people.id, pushSubscriptions.personId), eq(people.shopId, shopId), livePerson()),
      )
      .innerJoin(
        userAccounts,
        and(
          eq(userAccounts.personId, pushSubscriptions.personId),
          eq(userAccounts.status, "active"),
        ),
      )
      .where(
        and(
          eq(pushSubscriptions.shopId, shopId),
          eq(pushSubscriptions.tripId, tripId),
          exists(
            db
              .select({ one: sql`1` })
              .from(personRoles)
              .where(
                and(
                  eq(personRoles.personId, pushSubscriptions.personId),
                  inArray(personRoles.role, [...STAFF_ROLES]),
                ),
              ),
          ),
        ),
      )
      .limit(MAX_PUSH_TARGETS_PER_EVENT);
    if (targets.length === 0) return 0;
    const [shop] = await db
      .select({ defaultLocale: shops.defaultLocale })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return 0;
    const localeRows = await db
      .select({ id: people.id, locale: people.locale })
      .from(people)
      // diveday:allow-deleted-people: locales for recipients the subscriptions already name.
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
    // The manifest's own payload shape, so the service worker shows it with
    // no change: it refreshes the saved copy and shows these words when no page
    // of the app is visible.
    return await sendPushTargets(
      db,
      shopId,
      targets,
      localeByPerson,
      shop.defaultLocale,
      config,
      (_target, t) => ({
        kind: "manifest-changed",
        tripId,
        url: message.url,
        ...message.words(t),
      }),
    );
  } catch {
    // Best-effort by design — see the docblock.
    return 0;
  }
}
