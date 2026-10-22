import { unstable_rethrow } from "next/navigation";
import { isStaff } from "@/lib/authz";

/**
 * The staff member whose request is sending mail right now, or null when no
 * staff session is in scope: a cron, the queue drain, a diver's own page, a
 * test. Read for the `diveday_sender` SES tag, so a bounce names who sent it.
 *
 * `@/lib/auth` is imported lazily: the send path lives under `src/db/`, which
 * `@/lib/auth` itself imports, and most sends run where no request exists.
 * Any failure reads as "nobody", because a send must never fail over who sent
 * it; Next's own control-flow errors are passed through untouched.
 */
export async function currentStaffPersonId(): Promise<string | null> {
  try {
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    return session?.user && isStaff(session.user.roles) ? session.user.personId : null;
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
