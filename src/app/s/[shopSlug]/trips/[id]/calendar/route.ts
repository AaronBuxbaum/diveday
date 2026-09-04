import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { requestTranslator } from "@/i18n/request";
import { formatTime } from "@/lib/format";
import { publicTripPath } from "@/lib/public-routes";
import { tripCalendarFile } from "@/lib/trip-calendar";

/**
 * **The diver's "add to my calendar" download** — a living anchor for the day
 * rather than a date holder (issue #1165, delight report D05).
 *
 * Two things it now carries that it did not:
 *
 * **It starts at the dock call.** The trip page already tells a diver to
 * arrive `dockCallMinutes` before departure (`dockDayOffsets`,
 * `src/lib/diver-planning.ts`), so an event beginning when the lines come off
 * is an event that makes a punctual diver late. Nothing is hidden by that: the
 * description states the departure time in the same breath, so the calendar
 * and the page cannot be read as disagreeing.
 *
 * **It points at the meeting point.** This used to hand the calendar the *dive
 * site's* location name, which for a boat dive is a reef — a place no calendar
 * app can navigate anyone to, and for a departure with its own meeting point
 * (issue #704) the wrong parking lot. The staff feed fixed exactly this in
 * `feed-trips.ts`; the diver's file was still doing it.
 *
 * **What is deliberately not here** is the packing line D05 also asks for.
 * This route is public and holds no booking, so it cannot know what *this*
 * diver rented, is bringing, or is provided (`PackingSection` composes that
 * from their own booking). A generic "bring your certification card" would be
 * an invented fact about a day the shop never described, which is the one
 * thing D05's boundary rules out.
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
  if (trip?.status !== "scheduled") return new NextResponse("Not found", { status: 404 });

  const { t, locale } = await requestTranslator(shop.defaultLocale);
  const tz = shop.timezone;
  const tripUrl = new URL(publicTripPath(shopSlug, id), request.url).toString();
  const dockCallAt = new Date(trip.startsAt.getTime() - shop.dockCallMinutes * 60_000);
  // Where the diver actually stands, falling back to the dive site only when
  // the shop has named no meeting point — the same order the staff feed uses.
  const meetingPoint =
    [trip.meetingPointLabel, trip.meetingPointAddress].filter(Boolean).join(", ") || null;

  const file = tripCalendarFile({
    title: `${trip.title} with ${shop.name}`,
    description: [
      t("trip.calendarDockCall", {
        dockCall: formatTime(dockCallAt, locale, tz),
        departure: formatTime(trip.startsAt, locale, tz),
      }),
      meetingPoint ? t("trip.calendarMeetingPoint", { place: meetingPoint }) : null,
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
  });
  return new NextResponse(file, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${shopSlug}-trip.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
