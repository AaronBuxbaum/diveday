import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { notificationTripTitle } from "@/lib/notifications/kinds";
import {
  isMissingReason,
  isStaleRollCallReason,
  STALE_ROLL_CALL_AFTER_MS,
  STALE_ROLL_CALL_LOOKBACK_MS,
} from "@/lib/roll-call-alerts";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb, DbExecutor } from "./client";
import { sendNotification } from "./notifications";
import { pushTripAlert } from "./push-subscriptions";
import { people, personRoles, shops, trips, userAccounts } from "./schema";
import { listRollCallGaps, type OpenRollCall } from "./today";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **The stale-roll-call alert's one pass** (batch 6, item 6; the rule is
 * `src/lib/roll-call-alerts.ts`). Hourly, from the crew-notices cron: no new
 * schedule. A departure is asked from half an hour past its end, but Today's
 * detector raises a count nobody started only once the boat is due home (the
 * end plus the hour's return buffer, `hasReturned`), so in practice an alert
 * goes at the first hourly pass after that; a count somebody started, or a
 * person recorded not back aboard, can go at the first pass past the half
 * hour. The words say "after the boat was due back at 4:00 PM", never a
 * duration they cannot keep.
 *
 * For each departure due one, it asks the Today queue's own detector
 * (`listRollCallGaps`) whether an after-dive count is still open, claims the
 * departure (`trips.roll_call_alerted_at`, a conditional update, so two passes
 * cannot both send), then tells the shop's owners by email and every device
 * following the departure's manifest by push. Once per departure. A pass that
 * delivered nothing at all gives the claim back, so the next one tries again,
 * and so does one whose send path threw: the claim is released in `finally`,
 * the pass goes on to the next departure, and the first throw is rethrown at
 * the end for the cron's error report (security review 20261014). No failure
 * leaves a boat marked alerted with nothing sent.
 *
 * Who is unaccounted for is never in the message: a count and a link to the
 * manifest, behind its sign-in. A demo shop and a rehearsal never alert.
 */

export type StaleRollCallSummary = {
  checked: number;
  alerted: number;
  emails: number;
  pushes: number;
  released: number;
};

/** The shop's owners with an active login: the alert's email recipients. */
async function ownerLogins(db: DbExecutor, shopId: string) {
  return db
    .selectDistinct({
      personId: people.id,
      fullName: people.fullName,
      email: userAccounts.email,
      locale: people.locale,
    })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        eq(userAccounts.status, "active"),
        eq(personRoles.role, "owner"),
      ),
    );
}

/** Take the departure's one alert, or learn another pass already has. */
async function claimAlert(db: DbExecutor, shopId: string, tripId: string, now: Date) {
  const claimed = await db
    .update(trips)
    .set({ rollCallAlertedAt: now })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), isNull(trips.rollCallAlertedAt)))
    .returning({ id: trips.id });
  return claimed.length > 0;
}

/** Give the claim back after a pass that reached nobody, unless a later claim took it. */
async function releaseAlert(db: DbExecutor, shopId: string, tripId: string, claimedAt: Date) {
  await db
    .update(trips)
    .set({ rollCallAlertedAt: null })
    .where(
      and(eq(trips.id, tripId), eq(trips.shopId, shopId), eq(trips.rollCallAlertedAt, claimedAt)),
    );
}

/**
 * The one gap a departure's alert is about: a stated missing person first, then
 * the earliest open after-dive count — the order the Today rows lead with.
 */
function alertingGap(gaps: readonly OpenRollCall[]): OpenRollCall | null {
  const afterDive = gaps.filter((gap) => isStaleRollCallReason(gap.reason) && !gap.stale);
  return afterDive.find((gap) => isMissingReason(gap.reason)) ?? afterDive[0] ?? null;
}

export async function sendStaleRollCallAlerts(
  db: AppDb,
  input: { now?: Date; origin?: string | null; provider?: NotificationProvider } = {},
): Promise<StaleRollCallSummary> {
  const now = input.now ?? nowDate();
  const summary: StaleRollCallSummary = {
    checked: 0,
    alerted: 0,
    emails: 0,
    pushes: 0,
    released: 0,
  };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return summary;
  let failure: unknown;
  const due = await db
    .select({ id: trips.id, shopId: trips.shopId })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        liveTrip(),
        // A rehearsal sends nothing to anyone (ADR 20261012-rehearsal-departures).
        notRehearsal(),
        eq(trips.status, "scheduled"),
        isNull(trips.rollCallAlertedAt),
        lte(trips.endsAt, new Date(now.getTime() - STALE_ROLL_CALL_AFTER_MS)),
        gte(trips.endsAt, new Date(now.getTime() - STALE_ROLL_CALL_LOOKBACK_MS)),
        // A demo shop's divers are seeded and its owner's address is anybody's.
        eq(shops.isDemo, false),
      ),
    );
  summary.checked = due.length;
  const byShop = new Map<string, string[]>();
  for (const trip of due) byShop.set(trip.shopId, [...(byShop.get(trip.shopId) ?? []), trip.id]);

  for (const [shopId, tripIds] of byShop) {
    const gaps = await listRollCallGaps(db, shopId, now, tripIds);
    const open = new Map<string, OpenRollCall>();
    for (const tripId of tripIds) {
      const gap = alertingGap(gaps.filter((row) => row.tripId === tripId));
      if (gap) open.set(tripId, gap);
    }
    if (open.size === 0) continue;
    const [shop] = await db
      .select({
        slug: shops.slug,
        name: shops.name,
        defaultLocale: shops.defaultLocale,
        timezone: shops.timezone,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) continue;
    const owners = await ownerLogins(db, shopId);
    for (const [tripId, gap] of open) {
      if (!(await claimAlert(db, shopId, tripId, now))) continue;
      const checkpoint = `after_dive_${gap.diveNumber}`;
      const rollCallUrl = `${origin}${shopPath(shop.slug, "trips", tripId, "manifest")}?checkpoint=${checkpoint}`;
      // `trips.title` is unbounded and the kind caps it: clipped here, so a
      // long title shortens the subject rather than failing every send.
      const tripTitle = notificationTripTitle(gap.title);
      let delivered = 0;
      try {
        for (const owner of owners) {
          const delivery = await sendNotification(
            db,
            {
              kind: "roll_call_stale",
              shopId,
              personId: owner.personId,
              tripId,
              to: owner.email,
              locale: recipientLocale(owner.locale, shop.defaultLocale),
              recipientName: owner.fullName,
              shopName: shop.name,
              tripTitle,
              diveNumber: gap.diveNumber,
              unaccounted: gap.uncounted,
              missing: isMissingReason(gap.reason),
              rollCallUrl,
              endsAt: gap.endsAt,
              timezone: shop.timezone,
              alertedAt: now,
            },
            input.provider,
          );
          if (delivery.status === "sent") {
            delivered += 1;
            summary.emails += 1;
          }
        }
        const pushes = await pushTripAlert(db, shopId, tripId, {
          url: `${shopPath(shop.slug, "trips", tripId, "manifest")}?checkpoint=${checkpoint}`,
          words: (t) => ({
            title: t("manifest.staleRollCall.pushTitle"),
            body: t("manifest.staleRollCall.pushBody", {
              title: tripTitle,
              count: gap.uncounted,
              dive: gap.diveNumber,
            }),
          }),
        });
        delivered += pushes;
        summary.pushes += pushes;
      } catch (error) {
        // The next departure still gets its pass; the throw reaches the
        // cron's error report once the pass is done.
        failure ??= error;
      } finally {
        if (delivered === 0) {
          await releaseAlert(db, shopId, tripId, now);
          summary.released += 1;
        }
      }
      if (delivered === 0) continue;
      summary.alerted += 1;
    }
  }
  // Ids and counts only — never a name or an address.
  log("roll_call_alert.pass", "info", summary);
  if (failure !== undefined) throw failure;
  return summary;
}
