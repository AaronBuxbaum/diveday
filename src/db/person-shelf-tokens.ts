import { and, count, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { createShelfToken, hashShelfToken, SHELF_TOKEN_TTL_MS } from "@/lib/shelf-links";
import type { AppDb, DbExecutor } from "./client";
import { people, personShelfTokens } from "./schema";

/**
 * Minting, verifying, counting and revoking the diver's shelf link.
 *
 * The row and the reasoning behind its shape are on `personShelfTokens` in
 * `./schema.ts`; the lifetime and the two path strings are in
 * `src/lib/shelf-links.ts`. This module owns the three rules that make the
 * capability safe:
 *
 * 1. **A token names one shop and one person, and the verify path returns
 *    both.** Every caller re-checks the shop it resolved against the shop it is
 *    rendering for — the storefront does, and the shelf page reads the shop
 *    *from* the token rather than from a URL it could be handed.
 * 2. **A record that is gone opens nothing.** Deleted, erased, or merged away:
 *    the join below refuses all three, so a link on an old phone dies with the
 *    record it named without anybody having to remember to revoke it.
 * 3. **One refusal shape.** Unknown, expired, revoked, or naming a record that
 *    is gone all return `null`, so a bearer never learns which — the same
 *    fail-closed uniformity `readKnownDiver` keeps.
 */

export type IssuedShelfToken = { token: string; tokenId: string; expiresAt: Date };

/**
 * A live shelf capability: which shop, which person, and the row's own id so
 * the caller can record the open against it.
 */
export type ShelfCapability = { tokenId: string; shopId: string; personId: string };

/**
 * How many links one diver may hold at once.
 *
 * A shelf link is handed out by a staffer tapping "Send the link", so the
 * ordinary number is one or two — a phone and a tablet. The ceiling exists
 * because nothing else bounds the row count for a diver a shop mails weekly,
 * and because twenty live credentials over one person's file is already more
 * doors than anybody wanted. Past it, the oldest live row is revoked rather
 * than the newest refused: a diver waiting on the link they just asked for must
 * always get one that works. Mirrors `MAX_LIVE_CAPABILITIES_PER_PURPOSE`.
 */
export const MAX_LIVE_SHELF_TOKENS = 20;

/**
 * The one shape a live row is looked up by. Kept as a helper because the
 * verify path, the count, and the retire sweep must agree on what "live"
 * means — a definition spelled three times is a definition that drifts.
 */
function liveShelfToken(now: Date) {
  return and(isNull(personShelfTokens.revokedAt), gt(personShelfTokens.expiresAt, now));
}

/**
 * Mint a shelf link for a diver at a shop.
 *
 * Returns null for a person this shop does not have, or one whose record is
 * deleted, erased or merged away — a caller may not mint a door onto a file
 * that is gone, and the answer is the same for all four so the caller cannot
 * use this to probe which.
 *
 * Deliberately **not** superseding: every mint is its own row, because the
 * diver record's "how many phones hold it" is a count of these and a shop that
 * texts a second link to a diver's tablet has not taken the first away.
 */
export async function issueShelfToken(
  db: AppDb,
  input: { shopId: string; personId: string; now?: Date },
): Promise<IssuedShelfToken | null> {
  const now = input.now ?? nowDate();
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!person) return null;

  await retireOldestLiveShelfTokens(db, input.shopId, input.personId, now);

  const token = createShelfToken();
  const expiresAt = new Date(now.getTime() + SHELF_TOKEN_TTL_MS);
  const [row] = await db
    .insert(personShelfTokens)
    .values({
      shopId: input.shopId,
      personId: input.personId,
      tokenHash: hashShelfToken(token),
      issuedAt: now,
      expiresAt,
    })
    .returning({ id: personShelfTokens.id });
  if (!row) return null;
  return { token, tokenId: row.id, expiresAt };
}

/** Keep the live set under its ceiling by revoking the oldest, never by refusing the newest. */
async function retireOldestLiveShelfTokens(
  db: AppDb,
  shopId: string,
  personId: string,
  now: Date,
): Promise<void> {
  const live = await db
    .select({ id: personShelfTokens.id })
    .from(personShelfTokens)
    .where(
      and(
        eq(personShelfTokens.shopId, shopId),
        eq(personShelfTokens.personId, personId),
        liveShelfToken(now),
      ),
    )
    .orderBy(personShelfTokens.issuedAt);
  const excess = live.slice(0, Math.max(0, live.length - (MAX_LIVE_SHELF_TOKENS - 1)));
  for (const row of excess) {
    await db
      .update(personShelfTokens)
      .set({ revokedAt: now })
      .where(eq(personShelfTokens.id, row.id));
  }
}

/**
 * Who this token is for, or null.
 *
 * The join onto `people` is the whole security boundary beside the digest: a
 * record that was deleted, erased or merged away resolves to nothing, so the
 * link on the phone of a diver the shop erased last week opens the same warm
 * dead-end an unknown token does. Read-only — recording the open is
 * `recordShelfOpen`, so a page that merely *checks* a token does not count as a
 * visit.
 */
export async function verifyShelfToken(
  db: DbExecutor,
  input: { token: string; now?: Date },
): Promise<ShelfCapability | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({
      tokenId: personShelfTokens.id,
      shopId: personShelfTokens.shopId,
      personId: personShelfTokens.personId,
    })
    .from(personShelfTokens)
    .innerJoin(people, eq(people.id, personShelfTokens.personId))
    .where(
      and(
        eq(personShelfTokens.tokenHash, hashShelfToken(input.token)),
        isNull(personShelfTokens.revokedAt),
        gt(personShelfTokens.expiresAt, now),
        // The person's own shop, not the token's, and they must agree — a row
        // whose two ids disagree is a bug, and this is where it stops.
        eq(people.shopId, personShelfTokens.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * One more open, and when. Called by the shelf page itself, never by the
 * storefront's cookie read: the greeting is not a visit to the shelf, and
 * counting it as one would make the diver record's number meaningless.
 */
export async function recordShelfOpen(
  db: DbExecutor,
  input: { tokenId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  await db
    .update(personShelfTokens)
    .set({ opens: sql`${personShelfTokens.opens} + 1`, lastOpenedAt: now })
    .where(eq(personShelfTokens.id, input.tokenId));
}

/** What the diver record shows on its shelf row. */
export type ShelfTokenStanding = {
  /** Every open of every link this diver has been sent, live or not. */
  opens: number;
  /** The most recent of those, or null if none has ever been opened. */
  lastOpenedAt: Date | null;
  /**
   * Links that still work **and** have been opened at least once — which is as
   * close to "phones holding it" as anything honest gets. A link sent and never
   * tapped is not a phone, and a revoked one is not either.
   */
  phones: number;
  /** Links that still work, opened or not — whether there is anything to open. */
  live: number;
};

export async function shelfTokenStanding(
  db: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<ShelfTokenStanding> {
  const now = input.now ?? nowDate();
  const scope = and(
    eq(personShelfTokens.shopId, input.shopId),
    eq(personShelfTokens.personId, input.personId),
  );
  const [totals] = await db
    .select({
      opens: sql<number>`coalesce(sum(${personShelfTokens.opens}), 0)::int`,
      lastOpenedAt: sql<Date | null>`max(${personShelfTokens.lastOpenedAt})`,
    })
    .from(personShelfTokens)
    .where(scope);
  const [liveRow] = await db
    .select({ live: count() })
    .from(personShelfTokens)
    .where(and(scope, liveShelfToken(now)));
  const [phoneRow] = await db
    .select({ phones: count() })
    .from(personShelfTokens)
    .where(and(scope, liveShelfToken(now), isNotNull(personShelfTokens.lastOpenedAt)));
  return {
    opens: Number(totals?.opens ?? 0),
    // PGlite hands `max()` back as a string on some builds; Postgres hands a
    // Date. Normalise here rather than at three call sites.
    lastOpenedAt: totals?.lastOpenedAt ? new Date(totals.lastOpenedAt) : null,
    phones: phoneRow?.phones ?? 0,
    live: liveRow?.live ?? 0,
  };
}

/**
 * Kill every shelf link this diver holds at this shop.
 *
 * Called by `anonymizeDiver` (H-02): erasure has to leave nothing that still
 * opens a person's file, and the verify join above would already refuse an
 * erased record — this makes the row say so too, so the fact survives a future
 * reader who queries the table without the join.
 *
 * Takes a `DbExecutor` so erasure can run it inside its own transaction.
 */
export async function revokeShelfTokens(
  db: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  await db
    .update(personShelfTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(personShelfTokens.shopId, input.shopId),
        eq(personShelfTokens.personId, input.personId),
        isNull(personShelfTokens.revokedAt),
      ),
    );
}
