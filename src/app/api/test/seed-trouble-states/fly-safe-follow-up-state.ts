import { NextResponse } from "next/server";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { recordFlySafeTold, sendFlySafeCorrections } from "@/db/fly-safe-correction";
import { bookings, people, personRoles, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { NotificationProvider } from "@/lib/notifications";

/** Synthetic delivery outcomes, only reachable through the guarded e2e route. */
export async function flySafeFollowUpStateResponse(request: Request, db: AppDb) {
  const params = new URL(request.url).searchParams;
  if (params.get("flySafeFollowUp") !== "1") return null;
  const shop = await getShopBySlug(db, params.get("shop") ?? DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const now = nowDate();
  const startsAt = new Date(now.getTime() + 20 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Flying guidance fixture",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 8,
      plannedDives: 2,
      exceedsNoDecoLimits: true,
    })
    .returning();
  if (!trip) throw new Error("flying guidance fixture trip missing");
  const [otherTrip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Other flying day",
      startsAt: new Date(startsAt.getTime() + HOUR_MS),
      endsAt: new Date(startsAt.getTime() + 5 * HOUR_MS),
      capacity: 8,
      plannedDives: 2,
      exceedsNoDecoLimits: true,
    })
    .returning();
  if (!otherTrip) throw new Error("other flying guidance fixture trip missing");
  for (const [name, email] of [
    ["Queue Diver", "queue-diver@example.com"],
    ["Contact Diver", "contact-diver@example.com"],
  ] as const) {
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: name, email })
      .returning();
    if (!person) throw new Error("flying guidance fixture person missing");
    await db.insert(personRoles).values({ personId: person.id, role: "diver" });
    const [seat] = await db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: name === "Queue Diver" ? trip.id : otherTrip.id,
        personId: person.id,
        bookedAs: "diver",
        participantType: "diver",
      })
      .returning();
    if (
      !seat ||
      !(await recordFlySafeTold(db, {
        shopId: shop.id,
        bookingId: seat.id,
        hours: 24,
        recipientEmail: email,
      }))
    )
      throw new Error("flying guidance fixture exposure missing");
  }
  const provider: NotificationProvider = {
    async send(notification) {
      return {
        status: "failed",
        retryable: "to" in notification && notification.to === "queue-diver@example.com",
      };
    },
  };
  await sendFlySafeCorrections(db, {
    shopId: shop.id,
    tripId: trip.id,
    now,
    emailProvider: provider,
  });
  await sendFlySafeCorrections(db, {
    shopId: shop.id,
    tripId: otherTrip.id,
    now,
    emailProvider: provider,
  });
  return NextResponse.json({
    ok: true,
    flySafeFollowUp: { tripId: trip.id, otherTripId: otherTrip.id },
  });
}
