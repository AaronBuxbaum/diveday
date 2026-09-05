import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { recipientLocale } from "@/lib/notifications/kinds";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { hasLiveReadinessCapability, issueBookingCapability } from "./booking-capabilities";
import type { AppDb } from "./client";
import { sendAndRecordNotification } from "./notifications";
import { recordTripActivity } from "./operations";
import { bookings, people, shops, trips } from "./schema";

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

 * Deliberately excludes: past departures (no recaps, no "your dive last
 * month" — a booking whose boat has already sailed has no readiness page
 * worth reissuing), cancelled bookings, and cancelled/completed trips. One
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
      const issued = await db.transaction(async (tx) => {
        await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.id, row.bookingId), eq(bookings.shopId, input.shopId)))
          .for("update");
        if (
          await hasLiveReadinessCapability(tx, {
            shopId: input.shopId,
            bookingId: row.bookingId,
            now,
          })
        ) {
          return null;
        }
        return issueBookingCapability(tx, {
          shopId: input.shopId,
          bookingId: row.bookingId,
          purpose: "readiness",
          now,
        });
      });
      // A live link already exists (nothing to send — the diver already has
      // working mail sitting in their inbox somewhere) or the booking went
      // away between the read above and the write. Either way, silently skip:
      // this loop's whole point is "resend what already exists", never a
      // reason to surface a difference to the requester.
      if (!issued) continue;

      const result = await sendAndRecordNotification(db, {
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
      }).catch(() => null);
      // Quiet, best-effort, same shape as `claimed their seat`
      // (seat-claims.ts) — a diver-initiated line on the trip's own trail,
      // never the reason a link that did go out fails to look sent.
      if (result?.status === "sent") {
        await recordTripActivity(db, {
          shopId: input.shopId,
          tripId: row.tripId,
          actorPersonId: row.personId,
          action: "requested a fresh link to their booking",
        }).catch(() => null);
      }
    } catch (error) {
      console.error("Find-my-booking resend failed for one booking", {
        bookingId: row.bookingId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }
}
