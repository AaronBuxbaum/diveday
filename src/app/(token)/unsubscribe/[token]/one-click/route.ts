import { NextResponse } from "next/server";
import { stopBookkeeperByToken } from "@/db/bookkeeper";
import { getDb } from "@/db/client";
import { optOutPersonFromCourtesyEmailByToken } from "@/db/courtesy-email";
import { unsubscribeAnytimeInterestByToken } from "@/db/interests";
import { stopShoreAlertsByToken } from "@/db/shore-alert-tokens";
import { turnOffWeeklyDigestByToken } from "@/db/weekly-digest";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

/**
 * RFC 8058 one-click unsubscribe: the target of the `List-Unsubscribe` /
 * `List-Unsubscribe-Post` headers (`src/lib/notifications/ses.ts`), POSTed by
 * the mail client itself with no human confirmation — that is the whole point
 * of the header pair, so unlike the sibling `../page.tsx` (a GET-safe page a
 * diver clicks and then confirms) this acts immediately on a bare POST.
 * Safe to do: the token is a capability the recipient's own inbox holds, a
 * corporate GET-prescanner never triggers a POST, and both mutators below are
 * idempotent — a resend of the same one-click request just re-sets the same
 * opt-out timestamp.
 *
 * Nested under `/unsubscribe/[token]/` rather than `/api/unsubscribe/[token]`
 * specifically so it stays covered by the existing `"unsubscribe"` entry in
 * `CAPABILITY_ROUTE_PREFIXES` (`src/lib/capability-urls.ts`) — that redaction
 * check only ever inspects the URL's first path segment, and
 * `observability.test.ts`'s `tokenRoutesOnDisk` guard fails the build if a
 * `[token]` directory ever sits deeper than that check can reach. An
 * `/api/...` sibling route missed this on the first pass of this change and
 * would have sent the raw, non-expiring unsubscribe token to Sentry on any
 * server error (security review finding on this task).
 *
 * One route serves every token kind, in the page's order: a last-minute-list
 * interest, a person's courtesy email, a staffer's Monday email, a shore
 * contact's roll-call alerts and a bookkeeper's month-end files.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  // Per IP first (third-pass security N3): a guessed token is a fresh token
  // bucket every time, so only the address limits a flood of guesses.
  const ip = await clientIp(request.headers);
  const byIp = await checkRateLimit(
    rateLimitKey("unsubscribe-one-click-ip", ip),
    RATE_LIMITS.oneClickUnsubscribeByIp,
  );
  if (!byIp.allowed) return new NextResponse(null, { status: 429 });
  const limit = await checkRateLimit(
    rateLimitKey("unsubscribe-one-click", token),
    RATE_LIMITS.oneClickUnsubscribe,
  );
  if (!limit.allowed) return new NextResponse(null, { status: 429 });

  const db = await getDb();
  const lastMinute = await unsubscribeAnytimeInterestByToken(db, { token });
  if (!lastMinute) {
    const courtesy = await optOutPersonFromCourtesyEmailByToken(db, { token });
    // The third kind: a staffer's own Monday email. The fourth: a shop's
    // shore contact stopping its roll-call alerts (H-20261014-stale-roll-call-recipients). The fifth, tried
    // last: a shop's bookkeeper stopping the month-end files (item 35, N1).
    const digest = courtesy ? null : await turnOffWeeklyDigestByToken(db, { token });
    const shore = courtesy || digest ? null : await stopShoreAlertsByToken(db, { token });
    if (!courtesy && !digest && !shore) await stopBookkeeperByToken(db, { token });
  }
  // A mail client acts on the status code alone and never renders a body.
  return new NextResponse(null, { status: 200 });
}
