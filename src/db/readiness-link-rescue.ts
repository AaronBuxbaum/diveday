import { and, eq, gt, isNull, notInArray, or } from "drizzle-orm";
import type { DiverLocale } from "@/i18n/settings";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { notificationProviderSignal } from "@/lib/notifications";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { recipientLocale } from "@/lib/notifications/kinds";
import { issueBookingCapability, staleReadinessBookingForResend } from "./booking-capabilities";
import type { AppDb, DbExecutor } from "./client";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { sendAndRecordNotification } from "./notifications";
import { bookings, notificationDeliveries, people, shops, trips } from "./schema";
import { seatNotCancelled } from "./trips-queries";

/**
 * What a rescue attempt answers with — a **code**, never a sentence, and never
 * anything about the diver. The page turns it into words.
 *
 * There is deliberately no `already_signed` twin of the waiver's: readiness has
 * no terminal state. A diver whose trip is fully prepped still has a page worth
 * reading, right up until the capability's own expiry.
 */
export type ReadinessLinkRescue =
  | "sent"
  | "no_email"
  | "current_link_live"
  | "unavailable"
  | "failed";

/**
 * How long after a readiness-link mail reached the provider a rescue answers
 * `current_link_live` instead of mailing again. The bound on a leaked dead URL
 * that does not depend on the rate limiter, which fails open.
 */
export const RESCUE_RESEND_COOLDOWN_MS = 15 * 60 * 1000;

/** Provider verdicts that mean the mail did not arrive, so it does not hold the cooldown. */
const UNDELIVERED = ["bounced", "complained", "failed", "suppressed"] as const;

/**
 * Did a readiness-link mail for this booking go out within the cooldown? Read
 * from the delivery trail; a send that failed, or that the provider later
 * reported undelivered, does not count.
 */
async function mailedWithinCooldown(
  db: DbExecutor,
  input: { shopId: string; bookingId: string; now: Date },
): Promise<boolean> {
  const [recent] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.shopId, input.shopId),
        eq(notificationDeliveries.bookingId, input.bookingId),
        eq(notificationDeliveries.kind, "readiness_link"),
        eq(notificationDeliveries.status, "sent"),
        or(
          isNull(notificationDeliveries.providerStatus),
          notInArray(notificationDeliveries.providerStatus, [...UNDELIVERED]),
        ),
        gt(
          notificationDeliveries.attemptedAt,
          new Date(input.now.getTime() - RESCUE_RESEND_COOLDOWN_MS),
        ),
      ),
    )
    .limit(1);
  return recent !== undefined;
}

/**
 * **A diver's self-serve rescue for a trip-prep link that aged out**: mail the
 * booking's live link, or a fresh one, to the address already on their booking.
 *
 * The security shape matters more than the mechanics, and it is the waiver
 * page's shape rather than a new one (`emailFreshWaiverLink`, issue #850). A
 * readiness URL *is* its capability, so a stale one that leaked — a forwarded
 * email, a shared screen — must never be tradeable for fresh access. Three
 * rules keep that true:
 *
 * - **The fresh token goes only to the address on file.** Never to the caller,
 *   never rendered, never confirmed back on the page.
 * - **The return value is a bare code.** No address, no token, no booking
 *   detail, not even the diver's name. What a bearer of a dead link can do here
 *   is *trigger a delivery to its owner*, which is what the booking's own
 *   confirmation email already did, and no more.
 * - **One mail per cooldown.** A live mailed link is re-sent rather than
 *   refused, because it may never have arrived: a rotation revokes the link
 *   the diver holds, and the send carrying its replacement can bounce (code
 *   security review of #2711, finding 2). Re-sending an existing link hands
 *   the caller nothing, since it goes only to the owner. What bounds a leaked
 *   dead URL is `mailedWithinCooldown`: within `RESCUE_RESEND_COOLDOWN_MS` of a
 *   readiness-link mail that went out, this answers `current_link_live` and
 *   sends nothing.
 *
 * A cancelled booking is refused by `issueBookingCapability`, which is the one
 * place that rule lives; a token that resolves to nothing is `unavailable`.
 * Repeat taps are safe by construction: the original stale token keeps
 * resolving after a send, so a later tap re-sends the live link or issues a
 * new one, and a tap inside the cooldown is refused by the guard above.
 */
/**
 * A rescue that is going to be attempted, and the facts it needs — or the
 * refusal that ends it before anything is spent.
 *
 * **Split from the send on purpose.** The caller spends a per-inbox rate-limit
 * budget between the two, and every refusal below reaches its answer from
 * reads alone. Deciding first means a leaked dead URL cannot burn the budget
 * its owner needs: before this split, five taps against a booking that holds a
 * live link returned `current_link_live` five times, sent nothing, and left the
 * real diver rate-limited for the hour (`security-reviewer`, issue #850).
 */
export type ReadinessRescuePlan =
  | { ok: false; reason: ReadinessLinkRescue }
  | {
      ok: true;
      shopId: string;
      bookingId: string;
      personId: string;
      tripId: string;
      email: string;
      diverName: string;
      locale: DiverLocale;
      shopName: string;
      timezone: string;
      tripTitle: string;
      origin: string;
    };

export async function planReadinessLinkRescue(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<ReadinessRescuePlan> {
  const stale = await staleReadinessBookingForResend(db, token, now);
  if (!stale) return { ok: false, reason: "unavailable" };

  // **The booking *and its trip*, both required good here.** The trip half is
  // not decoration: `verifyBookingCapability` fails closed on a cancelled trip
  // while `issueBookingCapability` does not, so without this a called-off
  // departure produced a dead-link page whose rescue answered
  // `current_link_live` — "you already have a link and it still works" — about
  // a trip that no longer runs, and, once those capabilities aged out, mailed a
  // fresh link naming that departure (`security-reviewer`, issue #850). Scoped
  // by the shop the capability itself named, never by anything the caller sent.
  const [context] = await db
    .select({
      personId: people.id,
      tripId: trips.id,
      email: people.email,
      diverName: people.fullName,
      personLocale: people.locale,
      shopName: shops.name,
      shopLocale: shops.defaultLocale,
      timezone: shops.timezone,
      tripTitle: trips.title,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, stale.bookingId),
        eq(bookings.shopId, stale.shopId),
        seatNotCancelled,
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  // One answer for "cancelled booking", "called-off trip" and "no such row",
  // deliberately: they are the same fact to the reader — this link is not
  // coming back — and telling them apart would tell a bearer which.
  if (!context) return { ok: false, reason: "unavailable" };
  if (!context.email) return { ok: false, reason: "no_email" };

  // Only now, with the booking known good, does "we just mailed it" mean a
  // link that actually works.
  if (await mailedWithinCooldown(db, { ...stale, now })) {
    return { ok: false, reason: "current_link_live" };
  }

  const origin = publicAppUrl();
  if (!origin) return { ok: false, reason: "failed" };

  return {
    ok: true,
    shopId: stale.shopId,
    bookingId: stale.bookingId,
    personId: context.personId,
    tripId: context.tripId,
    email: context.email,
    diverName: context.diverName,
    locale: recipientLocale(context.personLocale, context.shopLocale),
    shopName: context.shopName,
    timezone: context.timezone,
    tripTitle: context.tripTitle,
    origin,
  };
}

/**
 * Get the booking's live mailed link, or a new one, and mail it to the address
 * the plan carries.
 *
 * **The guard is re-checked inside a transaction that holds the booking row.**
 * Two taps a millisecond apart both read "nothing mailed lately" and both send
 * otherwise — normally bounded by the per-inbox rate limit, except that
 * `checkRateLimit` fails *open* on a store error and the default store is
 * per-process unless Upstash is provisioned. So on the day that limiter is
 * unavailable, this guard is the only thing between a leaked dead URL and an
 * unbounded run of mail at one diver, and a guard that is not serialized is
 * exactly the kind you defeat by racing it (`security-reviewer`, issue #850).
 * `issueWaiverRequest` decides inside a transaction for the same reason.
 */
export async function sendPlannedReadinessLink(
  db: AppDb,
  plan: Extract<ReadinessRescuePlan, { ok: true }>,
  now: Date = nowDate(),
): Promise<ReadinessLinkRescue> {
  const result = await withErasureCoordinatedBookingSend(
    db,
    {
      shopId: plan.shopId,
      bookingId: plan.bookingId,
      expectedPersonId: plan.personId,
      expectedTripId: plan.tripId,
      expectedEmail: plan.email,
    },
    async (tx) => {
      if (await mailedWithinCooldown(tx, { ...plan, now })) return "raced" as const;
      const issued = await issueBookingCapability(tx, {
        shopId: plan.shopId,
        bookingId: plan.bookingId,
        purpose: "readiness",
        expectedPersonId: plan.personId,
        expectedTripId: plan.tripId,
        now,
        delivered: true,
      });
      if (!issued) return null;
      return sendAndRecordNotification(
        tx,
        {
          kind: "readiness_link",
          bookingId: plan.bookingId,
          shopId: plan.shopId,
          to: plan.email,
          locale: plan.locale,
          diverName: plan.diverName,
          shopName: plan.shopName,
          tripTitle: plan.tripTitle,
          readinessUrl: new URL(readinessLinkPath(issued.token), `${plan.origin}/`).toString(),
          expiresAt: issued.expiresAt,
          timezone: plan.timezone,
        },
        { signal: notificationProviderSignal() },
      );
    },
  );
  if (result === "raced") return "current_link_live";
  if (!result) return "unavailable";
  if (result === null) return "unavailable";
  // Issued, but nothing left the building — an unconfigured provider, a
  // rejected recipient, a provider error. Never claim mail is on its way.
  return result.status === "sent" ? "sent" : "failed";
}

/**
 * The two halves together, for a caller with no budget to spend between them —
 * which in practice means a test. The action does its own rate limiting in the
 * gap and calls the halves directly.
 */
export async function emailFreshReadinessLink(
  db: AppDb,
  token: string,
  now: Date = nowDate(),
): Promise<ReadinessLinkRescue> {
  const plan = await planReadinessLinkRescue(db, token, now);
  return plan.ok ? sendPlannedReadinessLink(db, plan, now) : plan.reason;
}
