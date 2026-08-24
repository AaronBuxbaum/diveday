import { NextResponse } from "next/server";
import { parseCspReports } from "@/lib/csp-reports";
import { log } from "@/lib/log";
import { flushLogs } from "@/lib/observability";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * Where a browser posts what the Content-Security-Policy would have blocked
 * (issue #718). One line per violation, and the metric filter in
 * `infra/lib/observability.ts` counts them.
 *
 * The app's full policy ships as `Content-Security-Policy-Report-Only`, so
 * everything arriving here today is a thing that still works and would stop
 * working if the policy were promoted. That is the whole point: the enumeration
 * has to come from real traffic across the surfaces that differ most — the
 * public schedule, the embed, `/ready` and its map, the staff shell, a Stripe
 * redirect round trip — before anything is actually blocked.
 *
 * Shaped like `api/vitals`, for the same reasons: public and unauthenticated by
 * necessity (the report comes from a stranger's browser), answering 204 to
 * everything it will not act on, rate-limited per IP because every accepted
 * report costs a CloudWatch log line. What it does *not* share is the beacon's
 * looseness about content — see `src/lib/csp-reports.ts` for the fields
 * deliberately dropped, `script-sample` above all.
 */

/** A violation report is a few hundred bytes; this is the guard against the one that isn't. */
const MAX_BODY_BYTES = 16_384;

/** One posted body can carry a batch; this bounds what one caller can write. */
const MAX_REPORTS_PER_BODY = 20;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = await clientIp();
  const limit = await checkRateLimit(rateLimitKey("csp-report", ip), RATE_LIMITS.cspReport);
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

  const violations = parseCspReports(parsedJson).slice(0, MAX_REPORTS_PER_BODY);
  if (violations.length === 0) return new NextResponse(null, { status: 204 });

  for (const violation of violations) {
    log("security.csp_violation", "warn", { ...violation });
  }

  // Same reasoning as the vitals beacon: the page sending this is often on its
  // way out, so awaiting the flush is what stops a single visit's reports
  // depending on the instance surviving long enough to be asked again.
  await flushLogs();

  return new NextResponse(null, { status: 204 });
}
