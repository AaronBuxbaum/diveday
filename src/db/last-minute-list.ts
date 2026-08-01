import { and, asc, eq, isNull } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { findOrCreatePerson } from "./people";
import {
  type LastMinuteListEntry,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  type Person,
  people,
  shops,
} from "./schema";

export type JoinLastMinuteListInput = {
  shopId: string;
  fullName: string;
  email: string;
  phone?: string;
  /** Date-only (YYYY-MM-DD); either bound omitted means "no preference" on that side. */
  availableFrom?: string;
  availableUntil?: string;
};

export type JoinLastMinuteListOutcome = { entryId: string; personName: string };

/**
 * Adds (or reactivates) a diver's shop-wide last-minute-deal opt-in. Unlike
 * `joinTripWaitlist`, this is not scoped to one trip and never checks
 * capacity — it's a standing preference, not a claim on a specific charter.
 * A re-submission (same shop+email) overwrites the stated date range and
 * clears any prior unsubscribe, so a diver can update "when I'm around" by
 * just filling the form out again.
 */
export async function joinLastMinuteList(
  db: AppDb,
  input: JoinLastMinuteListInput,
): Promise<JoinLastMinuteListOutcome> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const availableFrom = input.availableFrom || null;
  const availableUntil = input.availableUntil || null;

  return db.transaction(async (tx) => {
    const { person } = await findOrCreatePerson(tx, {
      shopId: input.shopId,
      fullName,
      email,
      phone: input.phone,
    });

    const [existing] = await tx
      .select()
      .from(lastMinuteListEntries)
      .where(
        and(
          eq(lastMinuteListEntries.shopId, input.shopId),
          eq(lastMinuteListEntries.personId, person.id),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(lastMinuteListEntries)
        .set({ availableFrom, availableUntil, unsubscribedAt: null })
        .where(eq(lastMinuteListEntries.id, existing.id))
        .returning({ id: lastMinuteListEntries.id });
      if (!updated) throw new Error("joinLastMinuteList: update returned no row");
      return { entryId: updated.id, personName: person.fullName };
    }

    const [inserted] = await tx
      .insert(lastMinuteListEntries)
      .values({ shopId: input.shopId, personId: person.id, availableFrom, availableUntil })
      .returning({ id: lastMinuteListEntries.id });
    if (!inserted) throw new Error("joinLastMinuteList: insert returned no row");
    return { entryId: inserted.id, personName: person.fullName };
  });
}

export type LastMinuteListRow = { entry: LastMinuteListEntry; person: Person };

/** Every active (not unsubscribed) entry for a shop, oldest first. */
export async function listLastMinuteList(
  db: DbExecutor,
  shopId: string,
): Promise<LastMinuteListRow[]> {
  const rows = await db
    .select({ entry: lastMinuteListEntries, person: people })
    .from(lastMinuteListEntries)
    .innerJoin(people, eq(people.id, lastMinuteListEntries.personId))
    .where(
      and(eq(lastMinuteListEntries.shopId, shopId), isNull(lastMinuteListEntries.unsubscribedAt)),
    )
    .orderBy(asc(lastMinuteListEntries.createdAt));
  return rows;
}

/** Staff-initiated removal — kept as history (unsubscribedAt), not deleted. */
export async function unsubscribeLastMinuteListEntry(
  db: AppDb,
  input: { shopId: string; entryId: string; now?: Date },
): Promise<boolean> {
  const [updated] = await db
    .update(lastMinuteListEntries)
    .set({ unsubscribedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(lastMinuteListEntries.id, input.entryId),
        eq(lastMinuteListEntries.shopId, input.shopId),
      ),
    )
    .returning({ id: lastMinuteListEntries.id });
  return Boolean(updated);
}

/**
 * Mints a fresh, non-expiring bearer link for one entry (Leo — self-serve
 * email unsubscribe). Called once per deal blast, alongside
 * `sendLastMinuteDealBlast`, so every last-minute-deal email carries its own
 * working unsubscribe link even if an earlier email's link is later relied on
 * too — see `lastMinuteListUnsubscribeTokens`'s doc comment in schema.ts for
 * why this never expires and is never single-use.
 */
export async function issueLastMinuteListUnsubscribeToken(
  db: AppDb,
  input: { shopId: string; entryId: string },
): Promise<string> {
  const token = createBearerToken();
  await db.insert(lastMinuteListUnsubscribeTokens).values({
    shopId: input.shopId,
    entryId: input.entryId,
    tokenHash: hashBearerToken(token),
  });
  return token;
}

export type LastMinuteListUnsubscribeContext = {
  shopId: string;
  shopName: string;
  entryId: string;
  alreadyUnsubscribed: boolean;
};

/**
 * Resolves a bearer token to its entry, or null for anything that must read
 * as "this link isn't available" — an unknown token or a since-deleted shop.
 * Deliberately does not treat an already-unsubscribed entry as invalid (the
 * page still needs to render a real "you're already unsubscribed" state, not
 * a dead link, if a diver clicks an old email's link twice).
 */
export async function resolveLastMinuteListUnsubscribeToken(
  db: DbExecutor,
  token: string,
): Promise<LastMinuteListUnsubscribeContext | null> {
  const [row] = await db
    .select({
      tokenShopId: lastMinuteListUnsubscribeTokens.shopId,
      entryShopId: lastMinuteListEntries.shopId,
      shopName: shops.name,
      entryId: lastMinuteListEntries.id,
      unsubscribedAt: lastMinuteListEntries.unsubscribedAt,
    })
    .from(lastMinuteListUnsubscribeTokens)
    .innerJoin(
      lastMinuteListEntries,
      eq(lastMinuteListEntries.id, lastMinuteListUnsubscribeTokens.entryId),
    )
    .innerJoin(shops, eq(shops.id, lastMinuteListEntries.shopId))
    .where(eq(lastMinuteListUnsubscribeTokens.tokenHash, hashBearerToken(token)))
    .limit(1);
  if (!row) return null;
  // Defense in depth, mirroring verifyBookingCapability: nothing legitimate
  // can cause the token's own shopId to drift from its entry's, but a
  // resolved identity must never be trusted past that check.
  if (row.tokenShopId !== row.entryShopId) return null;
  return {
    shopId: row.entryShopId,
    shopName: row.shopName,
    entryId: row.entryId,
    alreadyUnsubscribed: row.unsubscribedAt !== null,
  };
}

/**
 * The one mutating step a diver's own unsubscribe click drives: resolves the
 * token, then unsubscribes the entry it names. Idempotent — a token clicked
 * twice (or an already-staff-unsubscribed entry) just confirms the same
 * outcome rather than erroring, matching `unsubscribeLastMinuteListEntry`'s
 * own idempotent write.
 */
export async function unsubscribeLastMinuteListEntryByToken(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<LastMinuteListUnsubscribeContext | null> {
  const context = await resolveLastMinuteListUnsubscribeToken(db, input.token);
  if (!context) return null;
  await unsubscribeLastMinuteListEntry(db, {
    shopId: context.shopId,
    entryId: context.entryId,
    now: input.now,
  });
  return context;
}
