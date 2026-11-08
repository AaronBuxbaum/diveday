import { and, eq, isNull, sql } from "drizzle-orm";
import { issueCapability, verifyCapability } from "../../db/capabilities";
import type { DbExecutor } from "../../db/client";
import { people, personRoles, shops, userAccounts } from "../../db/schema/index";
import { isStaff, type Role } from "../../lib/authz";
import { weeklyDigestWanted } from "../../lib/weekly-digest";

/**
 * **The Monday email's recipients and each staffer's answer** (market audit
 * item 51): who gets it, the per-person on/off choice, and the one-click
 * opt-out. The email's facts and its send path read Today's queue, so they
 * live above Today in `src/features/weekly-digest`.
 */

/** The shop row fields the digest reads. */
export type WeeklyDigestShop = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  defaultLocale: string;
  diversPerDivemaster: number;
  /** The shop's one currency: every `*_cents` the money section states is in it. */
  currency: string;
};

export type WeeklyDigestRecipient = {
  personId: string;
  fullName: string;
  email: string;
  locale: string | null;
  roles: Role[];
};

/**
 * Every active staff login at this shop, with their roles and their own
 * answer to the Monday email. Nothing here decides who gets it; that is
 * `weeklyDigestWanted`.
 */
export async function staffLogins(
  db: DbExecutor,
  shopId: string,
): Promise<(WeeklyDigestRecipient & { choice: boolean | null })[]> {
  const rows = await db
    .select({
      personId: people.id,
      fullName: people.fullName,
      email: userAccounts.email,
      locale: people.locale,
      choice: userAccounts.weeklyDigest,
      role: personRoles.role,
    })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        eq(userAccounts.status, "active"),
      ),
    );
  const byPerson = new Map<string, WeeklyDigestRecipient & { choice: boolean | null }>();
  for (const row of rows) {
    const existing = byPerson.get(row.personId);
    if (existing) {
      existing.roles.push(row.role as Role);
      continue;
    }
    byPerson.set(row.personId, {
      personId: row.personId,
      fullName: row.fullName,
      email: row.email,
      locale: row.locale,
      choice: row.choice,
      roles: [row.role as Role],
    });
  }
  return [...byPerson.values()].filter((person) => isStaff(person.roles));
}

/** The staff at this shop who get the Monday email. */
export async function listWeeklyDigestRecipients(
  db: DbExecutor,
  shopId: string,
): Promise<WeeklyDigestRecipient[]> {
  return (await staffLogins(db, shopId))
    .filter((person) => weeklyDigestWanted(person.choice, person.roles))
    .map(({ choice: _choice, ...person }) => person);
}

/** This staffer's answer and what it resolves to, for their settings page. */
export async function readWeeklyDigestChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<{ wanted: boolean; isDefault: boolean } | null> {
  const person = (await staffLogins(db, input.shopId)).find(
    (login) => login.personId === input.personId,
  );
  if (!person) return null;
  return {
    wanted: weeklyDigestWanted(person.choice, person.roles),
    isDefault: person.choice === null,
  };
}

/** Records this staffer's own answer. Only ever their own row: the caller passes the session. */
export async function setWeeklyDigestChoice(
  db: DbExecutor,
  input: { shopId: string; personId: string; wanted: boolean },
): Promise<boolean> {
  const updated = await db
    .update(userAccounts)
    .set({ weeklyDigest: input.wanted })
    .where(
      and(
        eq(userAccounts.personId, input.personId),
        sql`exists (select 1 from ${people} where ${people.id} = ${userAccounts.personId} and ${people.shopId} = ${input.shopId})`,
      ),
    )
    .returning({ id: userAccounts.id });
  return updated.length > 0;
}

export type WeeklyDigestUnsubscribeContext = {
  shopName: string;
  personId: string;
  alreadyOff: boolean;
};

/**
 * Mints the opt-out link one Monday email carries: a fresh, never-expiring
 * `weekly_digest_unsubscribe` capability for the staffer it goes to (issue
 * #3721). The sender calls it once the week's claim has landed, so a pass that
 * lost the claim mints nothing.
 */
export async function issueWeeklyDigestUnsubscribeToken(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<string> {
  return issueCapability(db, {
    purpose: "weekly_digest_unsubscribe",
    shopId: input.shopId,
    subjectId: input.personId,
  });
}

/**
 * Resolves an opt-out link from a Monday email to the person it was sent to,
 * or null for anything that must read as "this link isn't available". An
 * already-off person resolves, so a second click says so rather than failing.
 */
export async function resolveWeeklyDigestUnsubscribeToken(
  db: DbExecutor,
  token: string,
): Promise<WeeklyDigestUnsubscribeContext | null> {
  const capability = await verifyCapability(db, { purpose: "weekly_digest_unsubscribe", token });
  if (!capability) return null;
  const [row] = await db
    .select({
      personShopId: people.shopId,
      personId: people.id,
      shopName: shops.name,
      choice: userAccounts.weeklyDigest,
    })
    .from(people)
    .innerJoin(shops, eq(shops.id, people.shopId))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.id, capability.subjectId),
        // A deleted person's link is not available: the account it would turn
        // off belongs to nobody the shop still has.
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  // The capability's own shop must be its person's: a resolved identity is
  // never trusted past that check.
  if (!row || capability.shopId !== row.personShopId) return null;
  return { shopName: row.shopName, personId: row.personId, alreadyOff: row.choice === false };
}

/** The one-click opt-out: idempotent, and it only ever turns the email off. */
export async function turnOffWeeklyDigestByToken(
  db: DbExecutor,
  input: { token: string },
): Promise<WeeklyDigestUnsubscribeContext | null> {
  const context = await resolveWeeklyDigestUnsubscribeToken(db, input.token);
  if (!context) return null;
  await db
    .update(userAccounts)
    .set({ weeklyDigest: false })
    .where(eq(userAccounts.personId, context.personId));
  return context;
}
