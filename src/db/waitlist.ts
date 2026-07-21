import { and, count, eq, ne } from "drizzle-orm";
import { notify, publicAppUrl } from "@/lib/notifications";
import type { AppDb } from "./client";
import { bookings, people, personRoles, shops, trips, tripWaitlistEntries } from "./schema";

/**
 * Stamp a wait-list entry as invited, so the roster shows "Invited 2h ago" and
 * two staff don't both reach out. Shop-scoped, idempotent (a re-invite just
 * moves the timestamp forward). Stage 1 of seat recovery: the actual invite is
 * a one-tap email/composer in the UI; this records that it happened.
 *
 * Stage 2 (auto-invite position 1 on a cancellation, with an expiring window)
 * is deliberately not built here — it is blocked on the H-09 notification
 * policy decision. When that lands, it hangs off this same `invitedAt` column.
 */
export async function recordWaitlistInvite(
  db: AppDb,
  input: { shopId: string; entryId: string; now?: Date },
): Promise<boolean> {
  const [updated] = await db
    .update(tripWaitlistEntries)
    .set({ invitedAt: input.now ?? new Date() })
    .where(
      and(eq(tripWaitlistEntries.id, input.entryId), eq(tripWaitlistEntries.shopId, input.shopId)),
    )
    .returning({ id: tripWaitlistEntries.id });
  return Boolean(updated);
}

/**
 * How the freed-seat invite actually reached (or did not reach) the diver.
 * Anything but `sent` means the UI must hand staff the composer fallback (a
 * prewritten mailto/copy message) rather than pretend an email went out —
 * the exact mirror of `WaiverDelivery`.
 */
export type WaitlistInviteDelivery = "sent" | "no_email" | "unconfigured";

export type InviteWaitlistDiverResult =
  | { ok: true; delivery: WaitlistInviteDelivery; invitedAt: Date }
  | { ok: false; reason: "not_found" };

/**
 * Stamp a wait-list entry as invited *and* email the diver the freed-seat link
 * through the shared notification seam. Sending is best-effort: a missing
 * address, missing app origin, or a disabled/failed provider all resolve to a
 * non-`sent` delivery so the caller surfaces the copyable composer instead of
 * claiming mail went out. The invite is recorded either way — the durable
 * "Invited 2h ago" cue is the stamp, not the email.
 *
 * This is Stage 1 of seat recovery (WP-9); Stage 2 (auto-invite position 1 on a
 * cancellation) still hangs off this same `invitedAt` column when the H-09
 * policy row lands.
 */
export async function inviteWaitlistDiver(
  db: AppDb,
  input: { shopId: string; shopSlug: string; entryId: string; now?: Date },
): Promise<InviteWaitlistDiverResult> {
  const [ctx] = await db
    .select({ entry: tripWaitlistEntries, person: people, trip: trips, shop: shops })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .innerJoin(trips, eq(trips.id, tripWaitlistEntries.tripId))
    .innerJoin(shops, eq(shops.id, tripWaitlistEntries.shopId))
    .where(
      and(eq(tripWaitlistEntries.id, input.entryId), eq(tripWaitlistEntries.shopId, input.shopId)),
    )
    .limit(1);
  if (!ctx) return { ok: false, reason: "not_found" };

  const invitedAt = input.now ?? new Date();
  await recordWaitlistInvite(db, { shopId: input.shopId, entryId: input.entryId, now: invitedAt });

  const origin = publicAppUrl();
  let delivery: WaitlistInviteDelivery = "unconfigured";
  if (!ctx.person.email) {
    delivery = "no_email";
  } else if (origin) {
    const result = await notify({
      kind: "waitlist_invite",
      waitlistEntryId: ctx.entry.id,
      shopId: input.shopId,
      to: ctx.person.email,
      diverName: ctx.person.fullName,
      shopName: ctx.shop.name,
      tripTitle: ctx.trip.title,
      startsAt: ctx.trip.startsAt,
      endsAt: ctx.trip.endsAt,
      timezone: ctx.shop.timezone,
      bookingUrl: new URL(
        `/shop/${input.shopSlug}/schedule/${ctx.trip.id}`,
        `${origin}/`,
      ).toString(),
      invitedAt,
    }).catch(() => ({ status: "failed" as const }));
    delivery = result.status === "sent" ? "sent" : "unconfigured";
  }

  return { ok: true, delivery, invitedAt };
}

export type WaitlistRequest = {
  shopId: string;
  tripId: string;
  fullName: string;
  email: string;
  phone?: string;
};

export type WaitlistOutcome =
  | { ok: true; entryId: string; personName: string }
  | {
      ok: false;
      reason: "trip_unavailable" | "trip_available" | "already_booked" | "already_waitlisted";
      entryId?: string;
      personName?: string;
    };

/**
 * Adds a diver to a full trip's first-come wait list. A wait-list entry is not
 * a booking and must never reserve a manifest seat.
 */
export async function joinTripWaitlist(db: AppDb, req: WaitlistRequest): Promise<WaitlistOutcome> {
  const email = req.email.trim().toLowerCase();
  const fullName = req.fullName.trim();

  return db.transaction(async (tx): Promise<WaitlistOutcome> => {
    const [trip] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, req.tripId), eq(trips.shopId, req.shopId)))
      .limit(1);
    if (trip?.status !== "scheduled" || trip.startsAt <= new Date()) {
      return { ok: false, reason: "trip_unavailable" };
    }

    const [capacity] = await tx
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), ne(bookings.status, "cancelled")));
    if ((capacity?.booked ?? 0) < trip.capacity) return { ok: false, reason: "trip_available" };

    let [person] = await tx
      .select()
      .from(people)
      .where(and(eq(people.shopId, req.shopId), eq(people.email, email)))
      .limit(1);
    if (!person) {
      [person] = await tx
        .insert(people)
        .values({ shopId: req.shopId, fullName, email, phone: req.phone })
        .returning();
      if (!person) throw new Error("joinTripWaitlist: person insert returned no row");
      await tx.insert(personRoles).values({ personId: person.id, role: "diver" });
    }

    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tripId, trip.id),
          eq(bookings.personId, person.id),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (booking) return { ok: false, reason: "already_booked" };

    const [existing] = await tx
      .select()
      .from(tripWaitlistEntries)
      .where(
        and(eq(tripWaitlistEntries.tripId, trip.id), eq(tripWaitlistEntries.personId, person.id)),
      )
      .limit(1);
    if (existing) {
      return {
        ok: false,
        reason: "already_waitlisted",
        entryId: existing.id,
        personName: person.fullName,
      };
    }

    const [entry] = await tx
      .insert(tripWaitlistEntries)
      .values({ shopId: req.shopId, tripId: trip.id, personId: person.id })
      .returning();
    if (!entry) throw new Error("joinTripWaitlist: entry insert returned no row");
    return { ok: true, entryId: entry.id, personName: person.fullName };
  });
}
