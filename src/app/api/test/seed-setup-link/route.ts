import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { setupRequests } from "@/db/schema";
import { issueSetupLink } from "@/db/setup-links";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { setupLinkPath } from "@/lib/setup-links";

/**
 * Mints a real, open setup link (ADR 20261009-single-use-setup-links) and hands
 * back the path it opens, so an e2e spec that onboards a shop drives
 * `/onboard` and `onboardAction` through the real link, the way the founder's
 * mail would. The token is otherwise only ever readable from inside that mail
 * and is hashed at rest. Gated identically to /api/test/reset, so it can never
 * be reachable in a real deployment, where it would be a sign-up door.
 *
 * The request it hangs the link on has empty answers on purpose: the form's
 * prefill then leaves every field as a spec that types into it expects.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const db = await getDb();
  const [row] = await db
    .insert(setupRequests)
    .values({
      shopName: "",
      region: "",
      runsBoat: false,
      currentSystem: "other",
      contactName: "",
      email: "",
      source: "unknown",
      locale: DEFAULT_DIVER_LOCALE,
    })
    .returning({ id: setupRequests.id });
  if (!row) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  const issued = await issueSetupLink(db, { setupRequestId: row.id });
  return NextResponse.json({
    path: setupLinkPath(issued.token),
    expiresAt: issued.expiresAt.toISOString(),
  });
}
