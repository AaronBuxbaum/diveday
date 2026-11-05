import { recapPageStateCached } from "@/db/recap-cached";
import { nowDate } from "@/lib/clock";
import {
  type DiveLogEntry,
  diveLogCsv,
  diveLogFileName,
  diveLogFormat,
  diveLogUddf,
} from "@/lib/dive-log-export";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { verifyRecapToken } from "@/lib/recap-links";
import { clientIp } from "@/lib/request-ip";

/**
 * **The diver's log entry as a file** (loop 5, row 13): `?format=csv` or
 * `?format=uddf`, for the departure this signed recap link belongs to.
 *
 * Authorized exactly as the recap page is: the token in the path is the whole
 * credential, and the answer is that booking's alone. The file carries what
 * the recap's dive record shows (the day, the shop, the sites, the conditions
 * the crew wrote down) and no token, link or contact detail. Throttled before
 * the token is looked up, like every other capability door, and every refusal
 * (a dead link, a recap not yet open, a cancelled seat) is the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (
    !(
      await checkRateLimit(
        rateLimitKey("recap-log", await clientIp()),
        RATE_LIMITS.capabilityAction,
      )
    ).allowed
  ) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
  const format = diveLogFormat(new URL(request.url).searchParams.get("format"));
  const bookingId = verifyRecapToken(token);
  const state = format && bookingId ? await recapPageStateCached(bookingId) : null;
  if (!format || state?.kind !== "recap") {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const { data } = state;
  const entry: DiveLogEntry = {
    shopName: data.shop.name,
    tripTitle: data.trip.title,
    startsAt: data.trip.startsAt,
    timeZone: data.shop.timezone,
    siteNames: data.diveRecord
      ? data.diveRecord.actualSiteNames
      : data.sites.map((site) => site.name),
    waterTemperatureC: data.trip.waterTemperatureC,
    visibilityMeters: data.trip.visibilityMeters,
    surfaceConditions: data.trip.surfaceConditions,
  };
  const body = format === "csv" ? diveLogCsv(entry) : diveLogUddf(entry, nowDate());
  return new Response(body, {
    headers: {
      "Content-Type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${diveLogFileName(entry, format)}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
