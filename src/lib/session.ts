import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { hasPlatformAccess, loadPlatformAccess } from "@/db/platform-mailboxes";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";

/**
 * Server-side staff gate for /shop surfaces. The proxy already blocks these
 * routes at the edge; this is the inner layer that server code must still
 * call (ADR-0006). Role-specific gates (H-14) go a step further and re-check
 * the person's live roles against the database — see `src/db/authz.ts`.
 */
export async function requireStaffSession() {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) redirect("/sign-in");
  return session;
}

/**
 * Server-side gate for `/admin` — DiveDay's own surfaces, not a shop's
 * (20260724-resend-webhook-email-events). Answers 404 rather than 403 for a
 * signed-in staff member with no platform access: a dive-shop owner has no
 * business learning that an operator console exists, and "not found" tells
 * them nothing. Access is re-read from the database on every request, so
 * removing someone takes effect immediately rather than at their next sign-in.
 */
export async function requirePlatformSession() {
  const session = await requireStaffSession();
  const db = await getDb();
  const access = await loadPlatformAccess(db, session.user.personId);
  if (!hasPlatformAccess(access)) notFound();
  return { session, access, db };
}

/** As {@link requirePlatformSession}, but only the deploy-time admin allowlist passes. */
export async function requirePlatformAdminSession() {
  const context = await requirePlatformSession();
  if (!context.access.isAdmin) notFound();
  return context;
}
