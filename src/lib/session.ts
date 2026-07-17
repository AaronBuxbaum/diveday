import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";

/**
 * Server-side staff gate for /shop surfaces. The proxy already blocks these
 * routes at the edge; this is the inner layer that server code must still
 * call (ADR-0006).
 */
export async function requireStaffSession() {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) redirect("/sign-in");
  return session;
}
