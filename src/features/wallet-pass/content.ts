import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { queryAll } from "@/db/query-helpers";
import { boats, bookings, people, shops, trips } from "@/db/schema";
import { meetingWindowsByTrip } from "@/db/trip-meeting-windows";
import { listTripDives, tripPublicCrew } from "@/db/trips";
import { latestTripStage } from "@/features/trip-stages";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { meetingPointOf, shopAddressPartsOf } from "@/lib/meeting-point";
import { liveStageOf } from "@/lib/trip-stages";
import { buildPassContent, type PassLabels } from "./rules";

/** The stored locale is the renderer's locale; a cron never negotiates a new one. */
export async function readPassContent(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  locale: string,
  now = nowDate(),
) {
  // diveday:allow-deleted-trips: a removed departure must void its issued passes.
  // diveday:allow-deleted-people: erased people produce a nameless void snapshot.
  const [row] = await db
    .select({ booking: bookings, person: people, trip: trips, shop: shops, boatName: boats.name })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    // Same person-first lock order as erasure. No refresh can restore an erased name.
    .for("share", { of: people });
  if (!row) return null;
  const { booking, person, trip, shop } = row;
  const t = diverTranslator(locale);
  const labels: PassLabels = {
    date: t("wallet.date"),
    dockCall: t("wallet.dockCall"),
    departs: t("wallet.departs"),
    boat: t("wallet.boat"),
    diver: t("wallet.diver"),
    meetingPlace: t("wallet.meetingPlace"),
    crew: t("wallet.crew"),
    sites: t("wallet.sites"),
    phone: t("wallet.phone"),
    plan: t("wallet.plan"),
    description: t("wallet.description"),
  };
  const [crew, dives, stage, windows] = await queryAll(db, [
    () => tripPublicCrew(db, shopId, trip.id),
    () => listTripDives(db as Parameters<typeof listTripDives>[0], shopId, trip.id),
    () => latestTripStage(db, shopId, trip.id),
    () => meetingWindowsByTrip(db, [trip]),
  ]);
  const point = meetingPointOf({
    shopName: shop.name,
    shopAddress: shopAddressPartsOf(shop),
    ...trip,
  });
  const content = buildPassContent({
    shopName: shop.name,
    title: trip.title,
    diverName: person.anonymizedAt
      ? ""
      : booking.identityUnconfirmedAt
        ? (booking.identityBookedAs?.trim() ?? "")
        : person.fullName,
    locale,
    timeZone: shop.timezone,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    dockCallMinutes: shop.dockCallMinutes,
    brandColor: shop.brandColor,
    boat: row.boatName,
    meetingPlace: [point.label, point.address].filter(Boolean).join(", "),
    crew: crew.map((member) => member.firstName),
    sites: dives.flatMap(({ diveSite }) => (diveSite ? [diveSite.name] : [])),
    phone: shop.contactPhone,
    stage:
      liveStageOf(
        stage,
        {
          startsAt: trip.startsAt,
          endsAt: trip.endsAt,
          timeZone: shop.timezone,
          meetingWindows: windows.get(trip.id),
        },
        now,
      ) && stage
        ? t(`wallet.stages.${stage.stage}`)
        : null,
    voided:
      booking.status === "cancelled" ||
      trip.status === "cancelled" ||
      !!trip.deletedAt ||
      !!person.anonymizedAt,
    labels,
  });
  return {
    content,
    personId: person.id,
    enabled: shop.walletPassesEnabled,
    erased: !!person.anonymizedAt,
  };
}
