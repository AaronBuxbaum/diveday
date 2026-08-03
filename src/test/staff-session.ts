import { and, eq } from "drizzle-orm";
import type { Session } from "next-auth";
import type { AppDb } from "@/db/client";
import { people } from "@/db/schema";
import type { Role } from "@/lib/authz";

/**
 * Helpers for the server-action authorization tests (`*.authz.test.ts`).
 *
 * Those tests answer a question `src/lib/authz.test.ts` and
 * `src/db/authz.test.ts` cannot: the predicates are right, but does the *action*
 * actually call one before it writes? So they run the real exported action
 * against a real seeded database, with only the session and Next's navigation
 * primitives faked — delete a gate line from an action and the matching test
 * goes red.
 *
 * The staff below are the demo shop's own seeded people (`src/db/seed.ts`), each
 * with real `person_roles` rows and an active `user_accounts` row, because the
 * gates re-read live roles from the database (`loadActiveStaffRoles`) rather
 * than trusting the session. A made-up person id would fail every gate for the
 * wrong reason.
 */

/** Dana Reyes — owner *and* manager: passes every H-14 gate. */
export const SEEDED_OWNER_EMAIL = "dana@demo.invalid";
/** Marcus Webb — instructor: configures trips, but no money and no roster deletion. */
export const SEEDED_INSTRUCTOR_EMAIL = "marcus@demo.invalid";
/** Sal Moretti — captain: the lowest-privilege seeded staff role, refused by every H-14 gate. */
export const SEEDED_CAPTAIN_EMAIL = "sal@demo.invalid";

/** The seeded staff member's person id, by the email they sign in with. */
export async function seededStaffPersonId(
  db: AppDb,
  shopId: string,
  email: string,
): Promise<string> {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, email)))
    .limit(1);
  if (!person) throw new Error(`seeded staff member ${email} missing`);
  return person.id;
}

/**
 * A session shaped exactly like the one `requireStaffSession()` resolves.
 *
 * `roles` defaults to a *staff* role deliberately: these tests are about what
 * happens after the staff gate passes. Pass an inflated `roles` to model a stale
 * or forged JWT — the H-14 gates must ignore it and re-read the database.
 */
export function staffSession(input: {
  shopId: string;
  shopSlug: string;
  personId: string;
  roles?: Role[];
  name?: string;
}): Session {
  return {
    user: {
      personId: input.personId,
      shopId: input.shopId,
      shopSlug: input.shopSlug,
      roles: input.roles ?? ["captain"],
      name: input.name ?? "Seeded staff",
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session;
}

/** The prefix the `next/navigation` mock in each authz test throws with. */
export const REDIRECT_PREFIX = "REDIRECT:";

/**
 * Where the action sent staff. `redirect()` unwinds a server action by throwing,
 * so the mocked one throws too — that is what keeps these tests honest about the
 * writes *after* a refusal never running.
 */
export async function redirectedTo(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith(REDIRECT_PREFIX)) return message.slice(REDIRECT_PREFIX.length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}
