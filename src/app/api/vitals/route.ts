import { NextResponse } from "next/server";
import { redactCapabilityUrl } from "@/app/observability";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import {
  normalizeBeaconPath,
  webVitalsBeaconSchema,
  webVitalsLogContext,
} from "@/lib/observability/web-vitals";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * Where the browser's Core Web Vitals land — DiveDay's own Speed Insights
 * equivalent (ADR 20260806-cloudwatch-rum-and-vitals).
 *
 * One `sendBeacon` per page view arrives here, becomes one structured log line,
 * and the metric filters in `infra/lib/observability.ts` extract each figure as
 * a CloudWatch metric scored at p75.
 *
 * The endpoint answers 204 to everything it will not act on — a malformed body,
 * a rate-limited caller, an unparseable URL. A performance beacon has no
 * business telling a stranger's browser anything about how it was judged, and
 * `sendBeacon` has no way to read a response in any case.
 */

/** Bodies are a few hundred bytes; this is the guard against the one that isn't. */
const MAX_BODY_BYTES = 8_192;

/**
 * UTF-8 bytes, not `String.length`. The two differ by up to 3x on non-ASCII
 * input, so measuring characters against a limit named in bytes lets a
 * multi-byte payload through at several times the intended size — raised in
 * review, and worth fixing on a public endpoint even though the cap is
 * generous.
 */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = await clientIp();
  const limit = await checkRateLimit(rateLimitKey("web-vitals", ip), RATE_LIMITS.webVitalsBeacon);
  if (!limit.allowed) return new NextResponse(null, { status: 204 });

  const raw = await request.text().catch(() => "");
  if (raw.length === 0 || byteLength(raw) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = webVitalsBeaconSchema.safeParse(parsedJson);
  if (!parsed.success) return new NextResponse(null, { status: 204 });

  // Two steps, in this order, and this is the copy that counts — the
  // client-side redaction is a courtesy to whatever is on the wire, while this
  // is the boundary a waiver/ready/recap token must not cross into a log group.
  // `normalizeBeaconPath` first, so an anonymous caller cannot write an
  // absolute URL or 2KB of anything else into the `route` field a dashboard
  // query groups on; `redactCapabilityUrl` last, so redaction is the final word
  // and fails closed on anything it cannot parse.
  const route = redactCapabilityUrl(normalizeBeaconPath(parsed.data.url));

  log("web_vital.reported", "info", webVitalsLogContext(parsed.data, route));

  // A beacon fires as the page is going away, so this response is nobody's
  // latency. Awaiting the flush is what keeps a single-page visit's numbers from
  // depending on the instance surviving long enough to be asked again.
  await flushLogs();

  return new NextResponse(null, { status: 204 });
}
