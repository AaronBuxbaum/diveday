import { and, asc, eq, isNull } from "drizzle-orm";
import { isPlatformAdminEmail } from "@/lib/platform-admin";
import type { AppDb } from "./client";
import { people, platformMailboxes, platformMailboxMembers, userAccounts } from "./schema";

/**
 * DiveDay's own role addresses and who may read them
 * (20260724-resend-webhook-email-events).
 */

export type PlatformAccess = {
  /** Set by the deploy-time allowlist; may manage mailboxes and read unrouted mail. */
  isAdmin: boolean;
  /** Mailboxes this person is a member of. Empty for an admin who joined none. */
  mailboxIds: string[];
};

export const NO_PLATFORM_ACCESS: PlatformAccess = { isAdmin: false, mailboxIds: [] };

export function hasPlatformAccess(access: PlatformAccess): boolean {
  return access.isAdmin || access.mailboxIds.length > 0;
}

/**
 * What this signed-in person may see under `/admin`. Access is read from the
 * database rather than the session token, so removing someone from the
 * allowlist takes effect on their next request instead of at their next
 * sign-in — the same live re-check the shop role gates make
 * (`loadActiveStaffRoles`).
 *
 * The allowlist is matched against `user_accounts.email` — the credential the
 * session was actually minted from (`verifyCredentials`) — and never against
 * `people.email`. The two are usually equal and it is tempting to read the
 * nearer one, but `people.email` is ordinary profile data that any staff
 * member may rewrite through the diver editor (`updateDiver`), including on
 * their own row. Keying a global capability on it would let any shop owner
 * type an allowlisted address into their own profile and be a DiveDay
 * operator on the next request. `user_accounts.email` is globally unique and
 * only ever set when an account is minted.
 */
export async function loadPlatformAccess(
  db: AppDb,
  personId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PlatformAccess> {
  const [person] = await db
    .select({
      deletedAt: people.deletedAt,
      accountEmail: userAccounts.email,
      accountStatus: userAccounts.status,
    })
    .from(people)
    .leftJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(eq(people.id, personId))
    .limit(1);
  if (!person || person.deletedAt) return NO_PLATFORM_ACCESS;

  const memberships = await db
    .select({ mailboxId: platformMailboxMembers.mailboxId })
    .from(platformMailboxMembers)
    .innerJoin(platformMailboxes, eq(platformMailboxes.id, platformMailboxMembers.mailboxId))
    .where(
      and(eq(platformMailboxMembers.personId, personId), isNull(platformMailboxes.archivedAt)),
    );

  return {
    isAdmin: person.accountStatus === "active" && isPlatformAdminEmail(person.accountEmail, env),
    mailboxIds: memberships.map((row) => row.mailboxId),
  };
}

export type MailboxMember = { personId: string; fullName: string; email: string | null };

export type PlatformMailboxView = {
  id: string;
  address: string;
  label: string;
  members: MailboxMember[];
};

/** Every live mailbox with its members, for the admin management screen. */
export async function listPlatformMailboxes(db: AppDb): Promise<PlatformMailboxView[]> {
  const rows = await db
    .select({
      id: platformMailboxes.id,
      address: platformMailboxes.address,
      label: platformMailboxes.label,
      memberPersonId: platformMailboxMembers.personId,
      memberName: people.fullName,
      memberEmail: people.email,
    })
    .from(platformMailboxes)
    .leftJoin(platformMailboxMembers, eq(platformMailboxMembers.mailboxId, platformMailboxes.id))
    .leftJoin(people, eq(people.id, platformMailboxMembers.personId))
    .where(isNull(platformMailboxes.archivedAt))
    .orderBy(asc(platformMailboxes.address), asc(people.fullName));

  const byId = new Map<string, PlatformMailboxView>();
  for (const row of rows) {
    const mailbox = byId.get(row.id) ?? {
      id: row.id,
      address: row.address,
      label: row.label,
      members: [],
    };
    if (row.memberPersonId && row.memberName) {
      mailbox.members.push({
        personId: row.memberPersonId,
        fullName: row.memberName,
        email: row.memberEmail,
      });
    }
    byId.set(row.id, mailbox);
  }
  return [...byId.values()];
}

export type CreateMailboxResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate_address" };

/**
 * Adds a role address. The address is the routing key for every inbound
 * message, so it is lowercased on the way in and unique in the schema — two
 * mailboxes claiming `legal@dive.day` would make routing a coin flip.
 */
export async function createPlatformMailbox(
  db: AppDb,
  input: { address: string; label: string },
): Promise<CreateMailboxResult> {
  const address = input.address.trim().toLowerCase();
  const [row] = await db
    .insert(platformMailboxes)
    .values({ address, label: input.label.trim() })
    .onConflictDoNothing({ target: platformMailboxes.address })
    .returning({ id: platformMailboxes.id });
  return row ? { ok: true, id: row.id } : { ok: false, reason: "duplicate_address" };
}

/** Retires an address. Its received mail keeps pointing at it, and stops being readable. */
export async function archivePlatformMailbox(
  db: AppDb,
  mailboxId: string,
  now: Date,
): Promise<boolean> {
  const updated = await db
    .update(platformMailboxes)
    .set({ archivedAt: now })
    .where(and(eq(platformMailboxes.id, mailboxId), isNull(platformMailboxes.archivedAt)))
    .returning({ id: platformMailboxes.id });
  return updated.length > 0;
}

export type AddMemberResult =
  | { ok: true }
  | { ok: false; reason: "unknown_person" | "unknown_mailbox" };

/**
 * Grants a person read access by email, resolved against their *login*
 * (`user_accounts.email`) rather than their profile address.
 *
 * A reader needs a DiveDay login to reach `/admin` at all, so the login is the
 * address an operator means. It is also the only one that names a single
 * person: `people.email` is unique per shop, not globally, so any tenant can
 * put an arbitrary address on their own roster — which would let a shop squat
 * `jo@dive.day` before the real Jo has a row and receive the grant meant for
 * them, or add a second copy purely to make the address ambiguous and block
 * the grant. `user_accounts.email` is globally unique and can't be claimed
 * that way.
 */
export async function addPlatformMailboxMember(
  db: AppDb,
  input: { mailboxId: string; email: string },
): Promise<AddMemberResult> {
  const [mailbox] = await db
    .select({ id: platformMailboxes.id })
    .from(platformMailboxes)
    .where(and(eq(platformMailboxes.id, input.mailboxId), isNull(platformMailboxes.archivedAt)))
    .limit(1);
  if (!mailbox) return { ok: false, reason: "unknown_mailbox" };

  const email = input.email.trim().toLowerCase();
  const [account] = await db
    .select({ personId: userAccounts.personId })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .where(
      and(
        eq(userAccounts.email, email),
        eq(userAccounts.status, "active"),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!account) return { ok: false, reason: "unknown_person" };

  await db
    .insert(platformMailboxMembers)
    .values({ mailboxId: mailbox.id, personId: account.personId })
    .onConflictDoNothing({
      target: [platformMailboxMembers.mailboxId, platformMailboxMembers.personId],
    });
  return { ok: true };
}

export async function removePlatformMailboxMember(
  db: AppDb,
  input: { mailboxId: string; personId: string },
): Promise<boolean> {
  const removed = await db
    .delete(platformMailboxMembers)
    .where(
      and(
        eq(platformMailboxMembers.mailboxId, input.mailboxId),
        eq(platformMailboxMembers.personId, input.personId),
      ),
    )
    .returning({ id: platformMailboxMembers.id });
  return removed.length > 0;
}

/**
 * The mailbox that claims this recipient address, or null when none does.
 * Archived mailboxes are excluded, so mail to a retired address files as
 * unrouted rather than reaching people who no longer own it.
 */
export async function findMailboxForAddress(
  db: AppDb,
  address: string,
): Promise<{ id: string } | null> {
  const [mailbox] = await db
    .select({ id: platformMailboxes.id })
    .from(platformMailboxes)
    .where(
      and(
        eq(platformMailboxes.address, address.trim().toLowerCase()),
        isNull(platformMailboxes.archivedAt),
      ),
    )
    .limit(1);
  return mailbox ?? null;
}
