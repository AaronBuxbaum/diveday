import { isStaff } from "@/lib/authz";

/** The signed-in staff member and the shop their session belongs to. */
export type SendActor = { personId: string; shopId: string };

/**
 * The staff member whose request is sending mail right now, or null when no
 * staff session is in scope: a cron, the queue drain, a diver's own page, a
 * test. Read for the `diveday_sender` SES tag, so a bounce names who sent it.
 * The caller stamps it only on mail for the session's own shop
 * (`sentByFor`): a staffer booking on another shop's public page is a
 * customer there, not its sender.
 *
 * `@/lib/auth` is imported lazily: the send path lives under `src/db/`, which
 * `@/lib/auth` itself imports, and most sends run where no request exists.
 * Any failure reads as "nobody", because a send must never fail over who sent
 * it. Nothing sends mail while a page renders, so there is no prerender
 * signal here to pass through; a server action or route is where sends run.
 */
export async function currentSendActor(): Promise<SendActor | null> {
  try {
    // A send with no request cannot have a staff session. Check this before
    // loading the auth graph, which is expensive for workers and tests.
    const { headers } = await import("next/headers");
    await headers();
    const { auth } = await import("@/lib/auth");
    const session = await auth();
    return session?.user && isStaff(session.user.roles)
      ? { personId: session.user.personId, shopId: session.user.shopId }
      : null;
  } catch {
    return null;
  }
}

/** The person id to stamp on a send, when the actor belongs to the shop it is for. */
export function sentByFor(actor: SendActor | null, notification: object): string | null {
  if (!actor || !("shopId" in notification)) return null;
  return notification.shopId === actor.shopId ? actor.personId : null;
}
