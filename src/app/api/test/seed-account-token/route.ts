import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { issueAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { userAccounts } from "@/db/schema";

/**
 * Mints a real, valid account_tokens row for an existing account and hands
 * back the raw token — the only way an e2e spec can drive `/verify/[token]`,
 * `/reset-password/[token]`, or `/invite/[token]`'s actual happy path through
 * its real page and server action, since the token is otherwise only ever
 * readable from inside a real email (no staff-facing display to read it
 * from, unlike a waiver link) and is hashed at rest (unlike the stateless
 * `recap-links.ts` token `e2e/visual.spec.ts` computes directly). An invite
 * token still requires the account to already exist — the real invite
 * action (`inviteStaffMember`, 20260726-staff-invite-accounts) creates it;
 * this only re-mints a fresh token for it, exactly like a resend. Exists
 * only for e2e coverage (security review finding on
 * 20260725-account-lifecycle-emails); gated identically to /api/test/reset,
 * so it can never be reachable in a real deployment.
 */
const bodySchema = z.object({
  email: z.string().trim().email(),
  purpose: z.enum(["email_verification", "password_reset", "invite"]),
});

export async function POST(request: Request) {
  const hasRealDatabase = Boolean(process.env.DATABASE_URL);
  const productionRuntime = process.env.NODE_ENV === "production";
  const e2eHarness = process.env.DIVEDAY_E2E === "1";
  if (hasRealDatabase || (productionRuntime && !e2eHarness)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const db = await getDb();
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.email, parsed.data.email.toLowerCase()))
    .limit(1);
  if (!account) return NextResponse.json({ error: "account_not_found" }, { status: 404 });

  const issued = await issueAccountToken(db, {
    userAccountId: account.id,
    purpose: parsed.data.purpose,
  });
  return NextResponse.json({ token: issued.token, expiresAt: issued.expiresAt.toISOString() });
}
