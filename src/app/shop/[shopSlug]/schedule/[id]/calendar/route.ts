import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { tripCalendarFile } from "@/lib/trip-calendar";

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

  const tripUrl = new URL(`/shop/${shopSlug}/schedule/${id}`, request.url).toString();
  const file = tripCalendarFile({
    title: `${trip.title} with ${shop.name}`,
    description: trip.description,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    location: trip.diveSite?.locationName,
    url: tripUrl,
  });
  return new NextResponse(file, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${shopSlug}-trip.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
