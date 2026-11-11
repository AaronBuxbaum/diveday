import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked, listTripScheduleDays } from "@/db/trips";
import { courseCalendarFile, tripCalendarFile } from "@/features/trip-calendar";
import { requestTranslator } from "@/i18n/request";
import { courseDepthFormat } from "@/i18n/unit-labels";
import { resolveCourseContentDepths } from "@/lib/courses";
import { formatTime } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";

/**
 * Public calendar download: charter arrivals retain the dock call; courses
 * export their recorded meetings. No booking, packing list or private notes.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopSlug: string; id: string }> },
) {
  const { shopSlug, id } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return new NextResponse("Not found", { status: 404 });
  const trip = await getTripWithBooked(db, shop.id, id);
  // A rehearsal has no public URL (ADR 20261012-rehearsal-departures), so no file either.
  if (trip?.status !== "scheduled" || trip.isRehearsal) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { t, locale } = await requestTranslator(shop.defaultLocale);
  const tz = shop.timezone;
  const tripUrl = new URL(publicTripPath(shopSlug, id), request.url).toString();
  const dockCallAt = new Date(trip.startsAt.getTime() - shop.dockCallMinutes * 60_000);
  const meetingPoint =
    [trip.meetingPointLabel, trip.meetingPointAddress]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ") || null;
  const meetingDescription = meetingPoint
    ? t("trip.calendarMeetingPoint", { place: meetingPoint })
    : null;

  const file = trip.courseId
    ? courseCalendarFile({
        title: `${trip.title} with ${shop.name}`,
        description: [meetingDescription, trip.description].filter(Boolean).join("\n\n"),
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        location: meetingPoint,
        url: tripUrl,
        revision: trip.revision,
        meetings: await listTripScheduleDays(db, shop.id, trip.id),
        scheduleDays: trip.course
          ? resolveCourseContentDepths(trip.course, courseDepthFormat(t, shop.depthUnit))
              .scheduleDays
          : [],
      })
    : tripCalendarFile({
        title: `${trip.title} with ${shop.name}`,
        description: [
          t("trip.calendarDockCall", {
            dockCall: formatTime(dockCallAt, locale, tz),
            departure: formatTime(trip.startsAt, locale, tz),
          }),
          meetingDescription,
          trip.description,
        ]
          .filter(Boolean)
          .join("\n\n"),
        startsAt: dockCallAt,
        endsAt: trip.endsAt,
        location: meetingPoint ?? trip.diveSite?.locationName,
        url: tripUrl,
        // The departure, not the dock call: DTSTAMP is about the trip this copy
        // describes, and keeping it on the published time leaves the file
        // byte-identical for a shop that sets no dock call.
        stamp: trip.startsAt,
        revision: trip.revision,
      });
  return new NextResponse(file, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${shopSlug}-trip.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
