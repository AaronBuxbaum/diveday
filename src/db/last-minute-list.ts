import { and, asc, eq, isNull } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import type { DiveDeclaration } from "@/lib/dive-declaration";
import type { LastMinuteListWindow } from "@/lib/last-minute-list";
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
import { recordSelfDeclaredCards } from "./self-declared-cards";

export type JoinLastMinuteListInput = {
  shopId: string;
  fullName: string;
  email: string;
  phone?: string;
  /** Date-only (YYYY-MM-DD); either bound omitted means "no preference" on that side. */
  availableFrom?: string;
  availableUntil?: string;
  /**
   * What the joiner optionally said they can dive. Written onto the **person**
   * as a self-declared pending card, not onto the list entry — see
   * `recordSelfDeclaredCards`. Absent, or all-empty, records nothing.
   */
  declaration?: DiveDeclaration;
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
    const { person, nameMatches } = await findOrCreatePerson(tx, {
      shopId: input.shopId,
      fullName,
      email,
      phone: input.phone,
    });

    // Inside the same transaction as the opt-in itself: a joiner who told the
    // shop their level and a joiner who did not are two outcomes, not three, so
    // the card must not be able to land without the entry or the reverse. It
    // refuses to touch a card the shop actually captured — see the
    // anti-displacement rule, which is what makes this safe on a path anyone
    // can post to.
    //
    // `nameMatches` is H-13's borrowed-identity rule, applied to the one write
    // here that is evidence about a body. This form is unauthenticated, and an
    // email that already belongs to a diver under a *different* name is a
    // possible second human — a family sharing an inbox, or somebody typing an
    // address that is not theirs. Everywhere else that reaches this fork
    // refuses to write on a mismatch (`seat-claims.ts` will not even record a
    // phone number, `people.ts` will not record a locale), and certification
    // data is stronger than either. The **entry** is still created: joining a
    // marketing list under a borrowed address is the behaviour this feature
    // found, not one it introduced, and refusing the opt-in would be a new
    // regression. Only the safety record is withheld.
    if (nameMatches) {
      await recordSelfDeclaredCards(tx, {
        shopId: input.shopId,
        personId: person.id,
        level: input.declaration?.level,
        nitrox: input.declaration?.nitrox,
      });
    }

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

/**
 * Just the stated availability windows of a shop's active entries — no people,
 * no ordering. `listLastMinuteList` above answers "who is on the list"; this
 * answers the only question a *count* needs, which is how many of them a given
 * departure date falls inside (`lastMinuteEntryMatchesTripDate`).
 *
 * Today's queue reads it to decide whether a "fill these seats" row has anyone
 * behind it at all. A shop's opt-in list is a standing preference list, not a
 * transaction log, so this is a small read; the matching itself is pure
 * arithmetic over the rows, done once for every departure in the window.
 */
export async function listActiveLastMinuteWindows(
  db: DbExecutor,
  shopId: string,
): Promise<LastMinuteListWindow[]> {
  return db
    .select({
      availableFrom: lastMinuteListEntries.availableFrom,
      availableUntil: lastMinuteListEntries.availableUntil,
    })
    .from(lastMinuteListEntries)
    .where(
      and(eq(lastMinuteListEntries.shopId, shopId), isNull(lastMinuteListEntries.unsubscribedAt)),
    );
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
