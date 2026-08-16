import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { optOutPersonFromCourtesyEmailByToken } from "@/db/courtesy-email";
import { unsubscribeLastMinuteListEntryByToken } from "@/db/last-minute-list";
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
 * One route serves both token kinds, same as the page: a last-minute-list
 * entry's opt-out and a person's courtesy-email opt-out.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const ip = await clientIp();
  const limit = await checkRateLimit(
    rateLimitKey("unsubscribe-token", ip),
    RATE_LIMITS.accountTokenAction,
  );
  if (!limit.allowed) return new NextResponse(null, { status: 429 });

  const db = await getDb();
  const lastMinute = await unsubscribeLastMinuteListEntryByToken(db, { token });
  if (!lastMinute) {
    await optOutPersonFromCourtesyEmailByToken(db, { token });
  }
  // A mail client acts on the status code alone and never renders a body.
  return new NextResponse(null, { status: 200 });
}
