import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  FEED_FUTURE_DAYS,
  FEED_PAST_DAYS,
  feedDocument,
  listFeedTrips,
  tokenFromFeedSegment,
  touchCalendarFeed,
  verifyCalendarFeed,
} from "@/features/calendar-sync";
import { toDiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";

/**
 * The staff calendar subscription feed (docs ADR
 * 20260730-calendar-feed-subscriptions). The URL *is* the capability — it sits
 * outside `/shop` so no session gate applies, exactly like `/ready/[token]`
 * and `/waivers/[token]`.
 *
 * A calendar client polls this on its own schedule, unauthenticated and
 * without cookies, so every decision it depends on is re-derived here per
 * fetch rather than trusted from the moment the link was minted.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const db = await getDb();
  const now = nowDate();

  const feed = await verifyCalendarFeed(db, { token: tokenFromFeedSegment(token) });
  // One response for every failure — unknown token, revoked link, or a person
  // who has since lost their staff role. A subscriber must not be able to tell
  // "no such feed" from "your access was removed", and a calendar client shows
  // the status code to nobody anyway.
  if (!feed) return new NextResponse("Not found", { status: 404 });

  const trips = await listFeedTrips(db, {
    shopId: feed.shopId,
    personId: feed.personId,
    scope: feed.scope,
    now,
  });

  // The shop's locale, not the request's: the "browser" here is a calendar
  // bot whose Accept-Language says nothing about who reads the calendar.
  const t = staffTranslator(toDiverLocale(feed.shopLocale));
  const origin = new URL(`/calendar/${token}`, _request.url).origin;

  const file = feedDocument({
    trips,
    origin,
    shopSlug: feed.shopSlug,
    now,
    labels: {
      calendarName: t(feed.scope === "shop_trips" ? "feed.shopTripsName" : "feed.assignmentsName", {
        shop: feed.shopSlug,
      }),
      crew: t("feed.crew"),
      course: t("feed.course"),
      day: (dayNumber) => t("feed.day", { number: dayNumber }),
    },
  });

  await touchCalendarFeed(db, { feedId: feed.feedId, now });

  return new NextResponse(file, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Inline, not an attachment: a subscribing client fetches this
      // repeatedly and must never be told to save it as a file.
      "Content-Disposition": `inline; filename="${feed.shopSlug}-${feed.scope}.ics"`,
      // The response is credentialed and per-person; nothing in front of us
      // may hold a copy. Clients poll on their own schedule regardless, so
      // there is no freshness to gain by letting them cache.
      "Cache-Control": "private, no-store",
      // A feed URL must never end up in a search index or a referrer log.
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-DiveDay-Feed-Window": `${FEED_PAST_DAYS}/${FEED_FUTURE_DAYS}`,
    },
  });
}
