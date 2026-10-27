import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { notificationProviderSignal } from "@/lib/notifications";
import { recipientLocale } from "@/lib/notifications/kinds";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { hasLiveReadinessCapability, issueBookingCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { sendAndRecordNotification } from "./notifications";
import { recordTripActivity } from "./operations";
import { bookings, notificationDeliveries, people, shops, trips } from "./schema";
import { latestDiveDayBooking, planLogEntryLink, sendYourDayLink } from "./your-days";

/**
 * The "Can't find your link?" rescue (issue #723) — the same shape as
 * `emailFreshReadinessLink` (readiness-link-rescue.ts, issue #850), widened
 * from "one stale token names one booking" to "an email names zero or more
 * current ones". **This function's return value is never read by its
 * caller.** The caller (`requestFindMyBookingAction`) redirects to the same
 * confirmation before this runs — see that file's doc comment for why a
 * response that varies with whether an email matched is exactly the
 * enumeration oracle this feature exists to not be. What happens in here is
 * therefore fire-and-forget from the response's perspective, `after()`-
 * deferred by the caller; failures are swallowed per-booking rather than
 * thrown, because a Promise this caller never awaits (by design) has no
 * error boundary to throw into.
 *
 * **The per-inbox rate limit is spent here, not by the caller, and only once
 * real work is pending.** `RATE_LIMITS.findMyBookingByEmail` is checked after
 * an unlocked pass has found at least one booking that actually needs a fresh
 * mint — never unconditionally on every request. A live readiness capability
 * already covers essentially every healthy current booking (it is minted at
 * booking time and stays live until close to the trip's own end), so
 * spending the budget upfront would let anyone who merely knows a diver's
 * email address drain their narrow inbox budget with submissions that mint
 * nothing — the same shape `sendPlannedReadinessLink`'s doc comment warns
 * against, just reachable with no token at all (`security-reviewer`, issue
 * #723).
 *

 * Deliberately excludes: past departures (a booking whose boat has already
 * sailed has no readiness page worth reissuing; an address with no current
 * booking at all gets its latest log entry instead, `sendLatestLogEntry`,
 * H-132), cancelled bookings, and cancelled/completed trips. One
 * email per current booking, never a single digest naming all of them —
 * a digest would tell whoever typed the address every trip that person has
 * booked, which is a disclosure a plain "we sent your link" is not.
 */
export async function sendFindMyBookingLinks(
  db: AppDb,
  input: { shopId: string; email: string; origin: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  const email = input.email.trim().toLowerCase();
  if (!email) return;

  const [shop] = await db
    .select({ name: shops.name, defaultLocale: shops.defaultLocale, timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1);
  if (!shop) return;

  const rows = await db
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      tripId: bookings.tripId,
      diverName: people.fullName,
      personLocale: people.locale,
      tripTitle: trips.title,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(people.email, email),
        isNull(people.deletedAt),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        // Not yet departed, buffer included. The one place the rule is applied as a
        // *constant* rather than through `hasSailed`: the comparison happens in
        // Postgres, so what crosses is the offset, not the predicate.
        gt(trips.startsAt, new Date(now.getTime() - DEPARTURE_BUFFER_MS)),
      ),
    );

  if (rows.length === 0) {
    await sendLatestLogEntry(db, { shopId: input.shopId, email, now, origin: input.origin });
    return;
  }

  // Decide first, spend second (see the doc comment above): an unlocked read
  // is enough to gate the rate limit, since every mint below re-checks the
  // same guard under a row lock regardless — this pass only decides whether
  // any real work is pending, never whether a specific booking gets minted.
  const candidates = [];
  for (const row of rows) {
    const live = await hasLiveReadinessCapability(db, {
      shopId: input.shopId,
      bookingId: row.bookingId,
      now,
    });
    if (!live) candidates.push(row);
  }
  if (candidates.length === 0) return;

  if (
    !(
      await checkRateLimit(
        rateLimitKey("find-my-booking-email", email),
        RATE_LIMITS.findMyBookingByEmail,
      )
    ).allowed
  ) {
    return;
  }

  for (const row of candidates) {
    // Isolated per booking: one row's failure — including a lock-wait or
    // serialization failure from the `for("update")` below under concurrent
    // requests — must not silently stop every booking after it in the list
    // (`security-reviewer`, issue #723).
    try {
      // Same re-check-under-lock shape as `sendPlannedReadinessLink`: decide
      // and mint inside one transaction holding the booking row, so two
      // concurrent requests for the same address cannot both race past the
      // live-link guard and double-issue.
      const result = await withErasureCoordinatedBookingSend(
        db,
        {
          shopId: input.shopId,
          bookingId: row.bookingId,
          expectedPersonId: row.personId,
          expectedTripId: row.tripId,
          expectedEmail: email,
        },
        async (tx) => {
          if (
            await hasLiveReadinessCapability(tx, {
              shopId: input.shopId,
              bookingId: row.bookingId,
              now,
            })
          ) {
            return null;
          }
          const issued = await issueBookingCapability(tx, {
            shopId: input.shopId,
            bookingId: row.bookingId,
            purpose: "readiness",
            expectedPersonId: row.personId,
            expectedTripId: row.tripId,
            now,
            delivered: true,
          });
          if (!issued) return null;
          return sendAndRecordNotification(
            tx,
            {
              kind: "readiness_link",
              bookingId: row.bookingId,
              shopId: input.shopId,
              to: email,
              locale: recipientLocale(row.personLocale, shop.defaultLocale),
              diverName: row.diverName,
              shopName: shop.name,
              tripTitle: row.tripTitle,
              readinessUrl: new URL(readinessLinkPath(issued.token), `${input.origin}/`).toString(),
              expiresAt: issued.expiresAt,
              timezone: shop.timezone,
            },
            { signal: notificationProviderSignal() },
          );
        },
      ).catch(() => null);
      if (!result || result === null) continue;
      // Quiet, best-effort, same shape as `claimed their seat`
      // (seat-claims.ts) — a diver-initiated line on the trip's own trail,
      // never the reason a link that did go out fails to look sent.
      if (result?.status === "sent") {
        await recordTripActivity(db, {
          shopId: input.shopId,
          tripId: row.tripId,
          actorPersonId: row.personId,
          entry: { code: "booking_link_requested" },
        }).catch(() => null);
      }
    } catch (error) {
      log("find_my_booking.resend_failed", "error", {
        bookingId: row.bookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
}

/** How long one log-entry send for a booking stands before find-my-booking will send another. */
const LOG_ENTRY_RESEND_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * **An address with only past days gets its latest log entry** (fifth-loop
 * ideas, item 38; H-132). One email, the newest dive day's recap link, to the
 * address on file, never a list of every day: the same "one booking per mail"
 * line the current-booking half holds.
 *
 * A recap link is stateless, so there is no "a live one exists" guard to read.
 * Its stand-in is the delivery row: a readiness-link mail for that booking in
 * the last day means the diver already has one, and nothing is sent or spent.
 * Only then does the per-inbox budget pay for the send, so somebody who merely
 * knows the address cannot mail a past diver more than once a day.
 */
async function sendLatestLogEntry(
  db: AppDb,
  input: { shopId: string; email: string; now: Date; origin: string },
): Promise<void> {
  const matches = await db
    .select({ personId: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, input.shopId),
        eq(people.email, input.email),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .orderBy(desc(people.createdAt))
    .limit(1);
  const personId = matches[0]?.personId;
  if (!personId) return;
  const latest = await latestDiveDayBooking(db, { shopId: input.shopId, personId, now: input.now });
  if (!latest) return;

  const [recent] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.shopId, input.shopId),
        eq(notificationDeliveries.bookingId, latest.bookingId),
        eq(notificationDeliveries.kind, "readiness_link"),
        gt(
          notificationDeliveries.attemptedAt,
          new Date(input.now.getTime() - LOG_ENTRY_RESEND_GAP_MS),
        ),
      ),
    )
    .limit(1);
  if (recent) return;

  const plan = await planLogEntryLink(db, {
    shopId: input.shopId,
    day: latest,
    origin: input.origin,
  });
  if (!plan.ok) return;
  if (
    !(
      await checkRateLimit(
        rateLimitKey("find-my-booking-email", input.email),
        RATE_LIMITS.findMyBookingByEmail,
      )
    ).allowed
  ) {
    return;
  }
  try {
    await sendYourDayLink(db, plan, input.now);
  } catch (error) {
    log("find_my_booking.log_entry_failed", "error", {
      bookingId: latest.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
}
