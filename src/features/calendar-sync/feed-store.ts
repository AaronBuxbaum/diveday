import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { AppDb, DbExecutor } from "@/db/client";
import { calendarFeeds, people, personRoles, shops, userAccounts } from "@/db/schema";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { createFeedToken, hashFeedToken } from "./feed-token";

export type FeedScope = "assignments" | "shop_trips";

export type IssuedFeed = { token: string; scope: FeedScope };

/**
 * Only an owner or a manager may subscribe to the whole shop's departures;
 * every staff role may subscribe to their own assignments. A `shop_trips`
 * feed is effectively a rolling export of the operation, so it gets the
 * narrower gate.
 */
const SCOPE_ROLES: Record<FeedScope, readonly string[]> = {
  assignments: STAFF_ROLES,
  shop_trips: ["owner", "manager"],
};

async function rolesFor(db: DbExecutor, shopId: string, personId: string): Promise<string[]> {
  const rows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)));
  return rows.map((row) => row.role);
}

/**
 * Mints a feed credential, revoking any previous live one for the same
 * person+scope in the same transaction. Rotation is the *only* remedy for a
 * leaked subscription URL — the feed has no expiry, because one that lapsed
 * would silently stop updating a captain's calendar — so "issue" and "rotate"
 * are deliberately the same operation rather than two.
 *
 * Returns null for anyone who isn't this shop's staff, or who lacks the role
 * the scope requires. The caller cannot distinguish the two, and shouldn't.
 */
export async function issueCalendarFeed(
  db: AppDb,
  input: { shopId: string; personId: string; scope: FeedScope; now?: Date },
): Promise<IssuedFeed | null> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const [shop] = await tx
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .limit(1);
    if (!shop) return null;

    const roles = await rolesFor(tx, input.shopId, input.personId);
    const permitted = SCOPE_ROLES[input.scope];
    if (!roles.some((role) => permitted.includes(role))) return null;

    await tx
      .update(calendarFeeds)
      .set({ revokedAt: now })
      .where(
        and(
          eq(calendarFeeds.shopId, input.shopId),
          eq(calendarFeeds.personId, input.personId),
          eq(calendarFeeds.scope, input.scope),
          isNull(calendarFeeds.revokedAt),
        ),
      );

    const token = createFeedToken();
    await tx.insert(calendarFeeds).values({
      shopId: input.shopId,
      personId: input.personId,
      scope: input.scope,
      tokenHash: hashFeedToken(token),
      issuedAt: now,
    });
    return { token, scope: input.scope };
  });
}

export type CalendarFeedContext = {
  feedId: string;
  shopId: string;
  shopSlug: string;
  shopTimezone: string;
  shopLocale: string | null;
  personId: string;
  personName: string;
  scope: FeedScope;
};

/**
 * Resolves a feed token to its context, or null for anything a subscriber must
 * read as "this feed isn't available" — unknown token, revoked row, or a
 * person who has since lost the role their scope requires.
 *
 * That last check is the one that matters operationally: staff leave. Removing
 * someone's roles has to stop their calendar updating without anyone
 * remembering to hunt down the feed row, so authorization is re-derived on
 * every fetch rather than trusted from issue time.
 */
export async function verifyCalendarFeed(
  db: DbExecutor,
  input: { token: string },
): Promise<CalendarFeedContext | null> {
  const [row] = await db
    .select({
      feedId: calendarFeeds.id,
      shopId: calendarFeeds.shopId,
      personId: calendarFeeds.personId,
      scope: calendarFeeds.scope,
      personShopId: people.shopId,
      personName: people.fullName,
      shopSlug: shops.slug,
      shopTimezone: shops.timezone,
      shopLocale: shops.defaultLocale,
      accountStatus: userAccounts.status,
    })
    .from(calendarFeeds)
    .innerJoin(people, eq(people.id, calendarFeeds.personId))
    .innerJoin(shops, eq(shops.id, calendarFeeds.shopId))
    // Left, not inner: a staff member can exist without a sign-in account at
    // all, and that is not a reason to refuse their feed.
    .leftJoin(userAccounts, eq(userAccounts.personId, calendarFeeds.personId))
    .where(
      and(eq(calendarFeeds.tokenHash, hashFeedToken(input.token)), isNull(calendarFeeds.revokedAt)),
    )
    .limit(1);
  if (!row) return null;
  // Defence in depth: nothing legitimate moves a person between shops, but a
  // verified identity must never be trusted past that check.
  if (row.personShopId !== row.shopId) return null;
  // Disabling an account revokes sign-in but deliberately keeps the person's
  // roles (`setStaffAccountStatus` in src/db/staff-accounts.ts), so a
  // roles-only check would leave a suspended staff member's calendar quietly
  // updating with the shop's schedule. "No longer has access" has to mean
  // every door, including the one that needs no password.
  if (row.accountStatus === "disabled") return null;

  const roles = await rolesFor(db, row.shopId, row.personId);
  if (!roles.some((role) => SCOPE_ROLES[row.scope].includes(role))) return null;

  return {
    feedId: row.feedId,
    shopId: row.shopId,
    shopSlug: row.shopSlug,
    shopTimezone: row.shopTimezone,
    shopLocale: row.shopLocale,
    personId: row.personId,
    personName: row.personName,
    scope: row.scope,
  };
}

/** Stamps a successful fetch so staff can tell a live subscription from a dead URL. */
export async function touchCalendarFeed(
  db: AppDb,
  input: { feedId: string; now?: Date },
): Promise<void> {
  await db
    .update(calendarFeeds)
    .set({ lastAccessedAt: input.now ?? nowDate() })
    .where(eq(calendarFeeds.id, input.feedId));
}

export type CalendarFeedSummary = {
  scope: FeedScope;
  issuedAt: Date;
  lastAccessedAt: Date | null;
};

/** The live feeds a staff member holds, for the settings panel. */
export async function listCalendarFeeds(
  db: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<CalendarFeedSummary[]> {
  const rows = await db
    .select({
      scope: calendarFeeds.scope,
      issuedAt: calendarFeeds.issuedAt,
      lastAccessedAt: calendarFeeds.lastAccessedAt,
    })
    .from(calendarFeeds)
    .where(
      and(
        eq(calendarFeeds.shopId, input.shopId),
        eq(calendarFeeds.personId, input.personId),
        isNull(calendarFeeds.revokedAt),
      ),
    );
  return rows;
}

/** Turns off a subscription without minting a replacement. */
export async function revokeCalendarFeeds(
  db: AppDb,
  input: { shopId: string; personId: string; scope?: FeedScope; now?: Date },
): Promise<void> {
  const conditions = [
    eq(calendarFeeds.shopId, input.shopId),
    eq(calendarFeeds.personId, input.personId),
    isNull(calendarFeeds.revokedAt),
  ];
  if (input.scope) conditions.push(eq(calendarFeeds.scope, input.scope));
  await db
    .update(calendarFeeds)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(and(...conditions));
}

/**
 * Revokes every live feed held by people who no longer have any staff role at
 * the shop. `verifyCalendarFeed` already fails closed for them on the next
 * fetch; this is the cleanup that stops the rows accumulating.
 */
export async function revokeFeedsForFormerStaff(
  db: AppDb,
  input: { shopId: string; now?: Date },
): Promise<void> {
  const staff = await db
    .selectDistinct({ personId: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, input.shopId), inArray(personRoles.role, [...STAFF_ROLES])));
  const staffIds = staff.map((row) => row.personId);
  const conditions = [eq(calendarFeeds.shopId, input.shopId), isNull(calendarFeeds.revokedAt)];
  await db
    .update(calendarFeeds)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      staffIds.length === 0
        ? and(...conditions)
        : and(...conditions, notInArray(calendarFeeds.personId, staffIds)),
    );
}
