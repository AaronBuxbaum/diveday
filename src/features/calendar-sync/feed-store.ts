import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  livePersonCapabilities,
  mintCapability,
  openCapabilityAmong,
  revokePersonCapabilities,
  touchCapability,
} from "@/db/capabilities";
import type { AppDb, DbExecutor } from "@/db/client";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { STAFF_ROLES } from "@/lib/authz";
import type { CapabilityPurpose } from "@/lib/capabilities";
import { nowDate } from "@/lib/clock";

export type FeedScope = "assignments" | "shop_trips";

/**
 * Each scope is one `capabilities` purpose (ADR
 * 20261105-capabilities-shop-id-nullable): a reusable, never-expiring link
 * naming the staff member, one live per person and purpose.
 */
const FEED_PURPOSE = {
  assignments: "calendar_assignments",
  shop_trips: "calendar_shop_trips",
} as const satisfies Record<FeedScope, CapabilityPurpose>;

type FeedPurpose = (typeof FEED_PURPOSE)[FeedScope];

const FEED_PURPOSES: readonly FeedPurpose[] = Object.values(FEED_PURPOSE);

const SCOPE_OF = {
  calendar_assignments: "assignments",
  calendar_shop_trips: "shop_trips",
} as const satisfies Record<FeedPurpose, FeedScope>;

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

    // Serialize issuance for this person before reading anything else.
    //
    // The mint's revoke-then-insert is not atomic on its own: under READ
    // COMMITTED two concurrent issues can each see nothing to revoke and both
    // insert, leaving two live feeds where the model promises one. Locking
    // the person row closes that window even in the common case where there
    // is no existing feed row to lock (the mint takes the same lock again).
    // The partial unique index on live (person_id, purpose) rows is the
    // backstop if this is ever bypassed; this lock is what keeps it from being
    // reached. `no key update` still serializes two issues and leaves the
    // `KEY SHARE` of every insert naming this person alone.
    const [locked] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
      .for("no key update");
    if (!locked) return null;

    const roles = await rolesFor(tx, input.shopId, input.personId);
    const permitted = SCOPE_ROLES[input.scope];
    if (!roles.some((role) => permitted.includes(role))) return null;

    // The purpose supersedes per person: the mint revokes this person's live
    // feed of this scope before it inserts the new one.
    const { token } = await mintCapability(tx, {
      purpose: FEED_PURPOSE[input.scope],
      shopId: input.shopId,
      subjectId: input.personId,
      now,
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
  // The purpose is in the predicate: a token of any other purpose (an
  // unsubscribe link, an account token) never opens a feed.
  const feed = await openCapabilityAmong(db, { purposes: FEED_PURPOSES, token: input.token });
  if (!feed) return null;
  const [row] = await db
    .select({
      personShopId: people.shopId,
      personName: people.fullName,
      shopSlug: shops.slug,
      shopTimezone: shops.timezone,
      shopLocale: shops.defaultLocale,
      accountStatus: userAccounts.status,
    })
    .from(people)
    .innerJoin(shops, eq(shops.id, feed.shopId))
    // Left, not inner: a staff member can exist without a sign-in account at
    // all, and that is not a reason to refuse their feed.
    .leftJoin(userAccounts, eq(userAccounts.personId, people.id))
    // diveday:allow-deleted-people: a by-id read of the feed's own staffer; the role check below is the gate, and a removed person holds no live role.
    .where(eq(people.id, feed.subjectId))
    .limit(1);
  if (!row) return null;
  const scope = SCOPE_OF[feed.purpose];
  // Defence in depth: nothing legitimate moves a person between shops, but a
  // verified identity must never be trusted past that check.
  if (row.personShopId !== feed.shopId) return null;
  // Disabling an account revokes sign-in but deliberately keeps the person's
  // roles (`setStaffAccountStatus` in src/db/staff-accounts.ts), so a
  // roles-only check would leave a suspended staff member's calendar quietly
  // updating with the shop's schedule. "No longer has access" has to mean
  // every door, including the one that needs no password.
  if (row.accountStatus === "disabled") return null;

  const roles = await rolesFor(db, feed.shopId, feed.subjectId);
  if (!roles.some((role) => SCOPE_ROLES[scope].includes(role))) return null;

  return {
    feedId: feed.id,
    shopId: feed.shopId,
    shopSlug: row.shopSlug,
    shopTimezone: row.shopTimezone,
    shopLocale: row.shopLocale,
    personId: feed.subjectId,
    personName: row.personName,
    scope,
  };
}

/** Stamps a successful fetch so staff can tell a live subscription from a dead URL. */
export async function touchCalendarFeed(
  db: AppDb,
  input: { feedId: string; now?: Date },
): Promise<void> {
  await touchCapability(db, { id: input.feedId, now: input.now });
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
  const rows = await livePersonCapabilities(db, {
    purposes: FEED_PURPOSES,
    shopId: input.shopId,
    personId: input.personId,
  });
  return rows.map((row) => ({
    scope: SCOPE_OF[row.purpose],
    issuedAt: row.issuedAt,
    lastAccessedAt: row.lastAccessedAt,
  }));
}

/** Turns off a subscription without minting a replacement. */
export async function revokeCalendarFeeds(
  db: AppDb,
  input: { shopId: string; personId: string; scope?: FeedScope; now?: Date },
): Promise<void> {
  await revokePersonCapabilities(db, {
    purposes: input.scope ? [FEED_PURPOSE[input.scope]] : FEED_PURPOSES,
    shopId: input.shopId,
    personId: input.personId,
    now: input.now,
  });
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
    .where(
      and(
        eq(people.shopId, input.shopId),
        inArray(personRoles.role, [...STAFF_ROLES]),
        isNull(people.deletedAt),
      ),
    );
  await revokePersonCapabilities(db, {
    purposes: FEED_PURPOSES,
    shopId: input.shopId,
    keepPersonIds: staff.map((row) => row.personId),
    now: input.now,
  });
}
