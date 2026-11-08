import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { liveTrip, notRehearsal } from "@/db/trips";
import { listRollCallGaps, type OpenRollCall } from "@/features/roll-call-gaps";
import { issueShoreAlertStopToken } from "@/features/shore-alert-tokens";
import type { AppDb, DbExecutor } from "../../db/client";
import { sendNotification } from "../../db/notifications";
import { ownerLogins } from "../../db/owner-logins";
import { pushTripAlert } from "../../db/push-subscriptions";
import { shops, tripScheduleDays, trips } from "../../db/schema/index";
import { nowDate } from "../../lib/clock";
import { log } from "../../lib/log";
import {
  type NotificationProvider,
  publicAppUrl,
  recipientLocale,
  staleRollCallPush,
} from "../../lib/notifications/index";
import { notificationTripTitle } from "../../lib/notifications/kinds";
import { shoreAlertRecipient } from "../../lib/shore-alert-contact";
import { shopPath } from "../../lib/staff-notices";
import {
  isMissingReason,
  isStaleRollCallReason,
  STALE_ROLL_CALL_AFTER_MS,
  STALE_ROLL_CALL_LOOKBACK_MS,
} from "./rules";

/**
 * **The stale-roll-call alert's one pass** (batch 6, item 6; the rule is
 * `src/features/roll-call-alerts/rules.ts`). Hourly at `:06`, from the crew-notices cron:
 * no new schedule. A departure is asked from half an hour past its end, but
 * Today's detector raises a count nobody started only once the boat is due
 * home (the end plus the hour's return buffer, `hasReturned`), so its alert
 * goes at the first pass after that: 60 to 120 minutes past the end. A count
 * somebody started, or a person recorded not back aboard, goes at the first
 * pass past the half hour: 30 to 90 minutes. The words say "after the boat was
 * due back at 4:00 PM", never a duration they cannot keep.
 *
 * For each departure due one, it asks the Today queue's own detector
 * (`listRollCallGaps`) whether an after-dive count is still open, claims the
 * departure (`trips.roll_call_alerted_at`, a conditional update, so two passes
 * cannot both send), then tells the shop's owners by email and every device
 * following the departure's manifest by push. Once per departure, and on a
 * course once per meeting day (#2557): each day's count is its own. A pass that
 * reached none of them gives the claim back, so the next one tries again, and
 * so does one whose send path threw: the claim is released in `finally`, the
 * pass goes on to the next departure, and the first throw is rethrown at the
 * end for the cron's error report (security review 20261014). No failure
 * leaves a boat marked alerted with nothing sent.
 *
 * The message carries two counts, summed across the departure's diver and
 * crew rows: the people recorded not back aboard, and the people with no
 * result yet (EAP review on H-20261014-stale-roll-call-recipients). Who they are is never in it: counts and a
 * link to the manifest, behind its sign-in. A demo shop and a rehearsal never
 * alert.
 *
 * **The shore contact hears too** (H-20261014-stale-roll-call-recipients, decided 2026-10-15), from the
 * save, once the shop recorded their consent (`shoreAlertRecipient`, #4060):
 * one email per departure, in the shop's default language, naming the shop and
 * its phone, the departure, the dive, the counts and when it was sent, with
 * one link, the one that stops these alerts (`roll_call_stale_shore`). Its
 * send is claimed on its own (`trips.roll_call_shore_alerted_at`): a failed
 * shore send is tried again next pass, and a delivery ashore never keeps the
 * owners' claim, so Today's "Owners alerted" stays true. An owner who is also
 * the shore contact gets one copy, the owners', when that copy went.
 */

export type StaleRollCallSummary = {
  checked: number;
  /** Departures this pass reached somebody about, owners or shore. */
  alerted: number;
  emails: number;
  /** Of `emails`, the ones to a shop's shore contact (H-20261014-stale-roll-call-recipients). */
  shoreEmails: number;
  pushes: number;
  /** Owners' claims given back because no owner email or push landed. */
  released: number;
};

/** The two claims a departure's alert takes, one per audience. */
const CLAIMS = {
  owners: trips.rollCallAlertedAt,
  shore: trips.rollCallShoreAlertedAt,
} as const;
type Claim = keyof typeof CLAIMS;

/**
 * Take one of the departure's alerts for the meeting day that ended at
 * `dayEndsAt`, or learn another pass already has. A course alerts once per
 * meeting day (#2557): this day's alert is only ever due after it ends, so a
 * claim taken before then was about an earlier day, even one sent late, once
 * this day had begun (#2557 review). Returns the claim it replaced (`null`
 * when there was none), or `false` when another pass holds it.
 */
async function claimAlert(
  db: DbExecutor,
  claim: Claim,
  shopId: string,
  tripId: string,
  now: Date,
  dayEndsAt: Date,
): Promise<{ replaced: Date | null } | false> {
  const column = CLAIMS[claim];
  const [before] = await db
    .select({ at: column })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()));
  if (!before) return false;
  const replaced = before.at;
  // Conditional on the value just read: two passes cannot both take it.
  const where = and(
    eq(trips.id, tripId),
    eq(trips.shopId, shopId),
    replaced === null ? isNull(column) : and(eq(column, replaced), lt(column, dayEndsAt)),
  );
  const claimed =
    claim === "owners"
      ? await db
          .update(trips)
          .set({ rollCallAlertedAt: now })
          .where(where)
          .returning({ id: trips.id })
      : await db
          .update(trips)
          .set({ rollCallShoreAlertedAt: now })
          .where(where)
          .returning({ id: trips.id });
  return claimed.length > 0 ? { replaced } : false;
}

/** Give a claim back after a send that reached nobody, unless a later claim took it. */
async function releaseAlert(
  db: DbExecutor,
  claim: Claim,
  shopId: string,
  tripId: string,
  claimedAt: Date,
  replaced: Date | null,
) {
  const column = CLAIMS[claim];
  const where = and(eq(trips.id, tripId), eq(trips.shopId, shopId), eq(column, claimedAt));
  if (claim === "owners") await db.update(trips).set({ rollCallAlertedAt: replaced }).where(where);
  else await db.update(trips).set({ rollCallShoreAlertedAt: replaced }).where(where);
}

/** What one departure's alert says: the dive it leads with and both counts. */
type AlertingGap = {
  title: string;
  /** The end of the meeting day the alert is about (#2557); a one-day trip's own. */
  endsAt: Date;
  diveNumber: number;
  notBackAboard: number;
  awaiting: number;
};

/**
 * A departure's open after-dive rows, diver and crew, as one alert: the dive
 * of a stated missing person first, then of the earliest open count (the order
 * the Today rows lead with), and the two counts summed across the rows. A
 * diver and a crew member are different people, so the sums never count
 * anybody twice.
 *
 * The rows are the ones Today shows, and the detector gives a departure at
 * most one diver row and one crew row (`listRollCallGaps`, src/features/roll-call-gaps/store.ts):
 * each side's stated-missing dive, else its earliest open dive. So the counts
 * are those two dives' counts, which may be different dives; a second open
 * dive on the same side is not in the sum (dive-domain re-review #5). A
 * missing person on any dive still leads, because the detector searches every
 * dive for one first.
 */
function alertingGap(gaps: readonly OpenRollCall[]): AlertingGap | null {
  const afterDive = gaps.filter((gap) => isStaleRollCallReason(gap.reason) && !gap.stale);
  const lead = afterDive.find((gap) => isMissingReason(gap.reason)) ?? afterDive[0];
  if (!lead) return null;
  let notBackAboard = 0;
  let awaiting = 0;
  for (const gap of afterDive) {
    if (isMissingReason(gap.reason)) notBackAboard += gap.uncounted;
    awaiting += gap.awaiting;
  }
  return {
    title: lead.title,
    endsAt: lead.endsAt,
    diveNumber: lead.diveNumber,
    notBackAboard,
    awaiting,
  };
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
    shoreEmails: 0,
    pushes: 0,
    released: 0,
  };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return summary;
  let failure: unknown;
  const dueFrom = new Date(now.getTime() - STALE_ROLL_CALL_LOOKBACK_MS);
  const dueTo = new Date(now.getTime() - STALE_ROLL_CALL_AFTER_MS);
  // A course's earlier meeting day is due on its own (#2557): the run's
  // `ends_at` may be a fortnight after the Saturday whose count is open.
  const dayDue = await db
    .selectDistinct({ tripId: tripScheduleDays.tripId })
    .from(tripScheduleDays)
    .where(and(lte(tripScheduleDays.endsAt, dueTo), gte(tripScheduleDays.endsAt, dueFrom)));
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
        // A claim from before the run's last day may belong to an earlier
        // meeting day; the claim below decides per day.
        or(
          isNull(trips.rollCallAlertedAt),
          lt(trips.rollCallAlertedAt, dueTo),
          // The shore copy is owed only where there is somebody to send it to.
          and(
            or(isNull(trips.rollCallShoreAlertedAt), lt(trips.rollCallShoreAlertedAt, dueTo)),
            isNotNull(shops.shoreAlertEmail),
          ),
        ),
        or(
          and(lte(trips.endsAt, dueTo), gte(trips.endsAt, dueFrom)),
          dayDue.length > 0
            ? inArray(
                trips.id,
                dayDue.map((row) => row.tripId),
              )
            : undefined,
        ),
        // A demo shop's divers are seeded and its owner's address is anybody's.
        eq(shops.isDemo, false),
      ),
    );
  summary.checked = due.length;
  const byShop = new Map<string, string[]>();
  for (const trip of due) byShop.set(trip.shopId, [...(byShop.get(trip.shopId) ?? []), trip.id]);

  for (const [shopId, tripIds] of byShop) {
    const gaps = await listRollCallGaps(db, shopId, now, tripIds);
    const open = new Map<string, AlertingGap>();
    for (const tripId of tripIds) {
      // Only a meeting day that is itself due: a course's day two still out
      // is Today's to show, not this pass's to send. Of the due days, the
      // newest speaks (#2557 review): an earlier day's row, already alerted,
      // must not take the claim that this day's alert needs. It stays on Today.
      const dueRows = gaps.filter(
        (row) =>
          row.tripId === tripId &&
          row.endsAt.getTime() <= dueTo.getTime() &&
          row.endsAt.getTime() >= dueFrom.getTime() &&
          isStaleRollCallReason(row.reason) &&
          !row.stale,
      );
      const newestDay = Math.max(0, ...dueRows.map((row) => row.dayNumber ?? 1));
      const gap = alertingGap(dueRows.filter((row) => (row.dayNumber ?? 1) === newestDay));
      if (gap) open.set(tripId, gap);
    }
    if (open.size === 0) continue;
    const [shop] = await db
      .select({
        slug: shops.slug,
        name: shops.name,
        contactPhone: shops.contactPhone,
        defaultLocale: shops.defaultLocale,
        timezone: shops.timezone,
        shoreAlertEmail: shops.shoreAlertEmail,
        shoreAlertConsentAt: shops.shoreAlertConsentAt,
      })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) continue;
    const owners = await ownerLogins(db, shopId);
    const shore = shoreAlertRecipient({
      email: shop.shoreAlertEmail,
      consentAt: shop.shoreAlertConsentAt,
    });
    for (const [tripId, gap] of open) {
      const ownersClaim = await claimAlert(db, "owners", shopId, tripId, now, gap.endsAt);
      const shoreClaim =
        shore !== null && (await claimAlert(db, "shore", shopId, tripId, now, gap.endsAt));
      const ownersClaimed = ownersClaim !== false;
      const shoreClaimed = shoreClaim !== false;
      if (!ownersClaimed && !shoreClaimed) continue;
      const checkpoint = `after_dive_${gap.diveNumber}`;
      const rollCallUrl = `${origin}${shopPath(shop.slug, "trips", tripId, "manifest")}?checkpoint=${checkpoint}`;
      // `trips.title` is unbounded and the kind caps it: clipped here, so a
      // long title shortens the subject rather than failing every send.
      const tripTitle = notificationTripTitle(gap.title);
      const counts = { notBackAboard: gap.notBackAboard, awaiting: gap.awaiting };
      let ownersReached = 0;
      let shoreReached = false;
      /** The owners' addresses this pass delivered to, for the one-copy rule. */
      const ownerCopies = new Set<string>();
      try {
        if (ownersClaimed) {
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
                ...counts,
                rollCallUrl,
                endsAt: gap.endsAt,
                timezone: shop.timezone,
                alertedAt: now,
              },
              input.provider,
            );
            if (delivery.status === "sent") {
              ownersReached += 1;
              summary.emails += 1;
              ownerCopies.add(owner.email.trim().toLowerCase());
            }
          }
        }
        if (shoreClaimed && shore) {
          if (ownerCopies.has(shore.toLowerCase())) {
            // An owner who is also the shore contact already has the owners'
            // copy, sent this pass: that is their one copy.
            shoreReached = true;
          } else {
            const token = await issueShoreAlertStopToken(db, { shopId, email: shore });
            const delivery = await sendNotification(
              db,
              {
                kind: "roll_call_stale_shore",
                shopId,
                tripId,
                to: shore,
                locale: recipientLocale(null, shop.defaultLocale),
                shopName: shop.name,
                shopPhone: shop.contactPhone?.trim() || null,
                tripTitle,
                diveNumber: gap.diveNumber,
                ...counts,
                endsAt: gap.endsAt,
                timezone: shop.timezone,
                alertedAt: now,
                stopUrl: `${origin}/unsubscribe/${token}`,
              },
              input.provider,
            );
            if (delivery.status === "sent") {
              shoreReached = true;
              summary.emails += 1;
              summary.shoreEmails += 1;
            }
          }
        }
        if (ownersClaimed) {
          const pushes = await pushTripAlert(db, shopId, tripId, {
            url: `${shopPath(shop.slug, "trips", tripId, "manifest")}?checkpoint=${checkpoint}`,
            words: (locale) =>
              staleRollCallPush(locale, { title: tripTitle, dive: gap.diveNumber, ...counts }),
          });
          ownersReached += pushes;
          summary.pushes += pushes;
        }
      } catch (error) {
        // The next departure still gets its pass; the throw reaches the
        // cron's error report once the pass is done.
        failure ??= error;
      } finally {
        if (ownersClaimed && ownersReached === 0) {
          await releaseAlert(
            db,
            "owners",
            shopId,
            tripId,
            now,
            ownersClaim ? ownersClaim.replaced : null,
          );
          summary.released += 1;
        }
        if (shoreClaim && !shoreReached) {
          await releaseAlert(db, "shore", shopId, tripId, now, shoreClaim.replaced);
        }
      }
      if (ownersReached > 0 || shoreReached) summary.alerted += 1;
    }
  }
  // Ids and counts only — never a name or an address.
  log("roll_call_alert.pass", "info", summary);
  if (failure !== undefined) throw failure;
  return summary;
}
