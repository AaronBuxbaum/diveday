import { and, eq, gt, isNull, ne, or, type SQL } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import {
  CAPABILITY_POLICY,
  type CapabilityPolicy,
  type CapabilityPurpose,
  capabilityExpiry,
  capabilitySubject,
} from "@/lib/capabilities";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { capabilities, people, shops, userAccounts } from "./schema";

/**
 * The `capabilities` table's rows and the transitions on them (issue #2710):
 * mint one, verify one for a named purpose, open a live one, and spend one
 * whose purpose a use spends. The policy each purpose follows
 * is `CAPABILITY_POLICY` in `src/lib/capabilities.ts`; this module reads the
 * subject from it and nothing else, so a caller never chooses which column its
 * subject id lands in.
 *
 * What a capability opens, and what opening it does, stays with the thing it
 * opens (`src/db/interests.ts`, `src/db/courtesy-email.ts`,
 * `src/db/account-tokens.ts`): those modules call `verifyCapability` with their
 * own purpose and then read their own subject.
 */

/**
 * The shop a purpose's rows carry: a string for a `shop` purpose, null for a
 * `platform` one (ADR 20261105-capabilities-shop-id-nullable). The table's
 * `capabilities_scope_by_purpose` check holds every row to it.
 */
export type CapabilityShop<P extends CapabilityPurpose> = P extends CapabilityPurpose
  ? (typeof CAPABILITY_POLICY)[P]["scope"] extends "platform"
    ? null
    : string
  : never;

function subjectColumns(purpose: CapabilityPurpose, subjectId: string) {
  const none = { interestId: null, personId: null, sentTo: null, userAccountId: null };
  switch (capabilitySubject(purpose)) {
    case "interest":
      return { ...none, interestId: subjectId };
    case "person":
      return { ...none, personId: subjectId };
    case "shop_address":
      return { ...none, sentTo: subjectId.trim().toLowerCase() };
    case "user_account":
      return { ...none, userAccountId: subjectId };
  }
}

/** The column a purpose's subject sits in. */
function subjectColumn(purpose: CapabilityPurpose) {
  switch (capabilitySubject(purpose)) {
    case "interest":
      return capabilities.interestId;
    case "person":
      return capabilities.personId;
    case "shop_address":
      return capabilities.sentTo;
    case "user_account":
      return capabilities.userAccountId;
  }
}

type CapabilityRow = {
  id: string;
  shopId: string | null;
  personId: string | null;
  interestId: string | null;
  sentTo: string | null;
  userAccountId: string | null;
  usedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

const ROW = {
  id: capabilities.id,
  shopId: capabilities.shopId,
  personId: capabilities.personId,
  interestId: capabilities.interestId,
  sentTo: capabilities.sentTo,
  userAccountId: capabilities.userAccountId,
  usedAt: capabilities.usedAt,
  expiresAt: capabilities.expiresAt,
  revokedAt: capabilities.revokedAt,
};

function verified<P extends CapabilityPurpose>(
  purpose: P,
  row: CapabilityRow,
): VerifiedCapability<P> | null {
  const subject = capabilitySubject(purpose);
  const subjectId =
    subject === "interest"
      ? row.interestId
      : subject === "person"
        ? row.personId
        : subject === "shop_address"
          ? row.sentTo
          : row.userAccountId;
  // The table's checks make both unreachable; a null subject must still never
  // be handed on as an id, nor a shop purpose's row as one with no shop.
  if (!subjectId) return null;
  const platform = CAPABILITY_POLICY[purpose].scope === "platform";
  if (platform !== (row.shopId === null)) return null;
  return {
    id: row.id,
    shopId: row.shopId as CapabilityShop<P>,
    subjectId,
    usedAt: row.usedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

/** Not revoked and, for a purpose that expires, not past its deadline. */
function unrevokedAndUnexpired(now: Date) {
  return and(
    isNull(capabilities.revokedAt),
    or(isNull(capabilities.expiresAt), gt(capabilities.expiresAt, now)),
  );
}

/**
 * Mints a fresh capability and returns the token, which is shown once and
 * never stored: the row keeps only its digest. For a `shop_address` purpose
 * `subjectId` is the address the link is mailed to.
 *
 * A purpose that expires (`lifetime: "expires"`) gets `expires_at` from its
 * policy's `ttlMs` at `now`; a caller cannot choose a deadline. A purpose that
 * `supersedes` revokes every live link of that purpose before inserting, so
 * only the newest works: the shop's (`per: "shop"`) or the subject's
 * (`per: "subject"`). The mint locks that shop's or subject's row first
 * (inside the caller's transaction, if it has one), so two mints in flight
 * cannot both leave a live link. A purpose that `adds` leaves earlier links
 * working.
 */
export async function issueCapability<P extends CapabilityPurpose>(
  db: DbExecutor,
  input: IssueCapabilityInput<P>,
): Promise<string> {
  return (await mintCapability(db, input)).token;
}

export type IssueCapabilityInput<P extends CapabilityPurpose> = {
  purpose: P;
  /** The minting shop for a `shop` purpose; null for a `platform` one. */
  shopId: CapabilityShop<P>;
  subjectId: string;
  now?: Date;
};

/**
 * Locks the row a supersede is serialised on, so two mints in flight queue and
 * the second one's revoke sees the first one's insert. Throws for a subject
 * this module has no row to lock for, so a new policy cannot quietly lose the
 * invariant.
 */
async function lockForSupersede(
  db: DbExecutor,
  purpose: CapabilityPurpose,
  per: "shop" | "subject",
  shopId: string | null,
  subjectId: string,
): Promise<void> {
  if (per === "shop") {
    if (!shopId) throw new Error(`${purpose} supersedes per shop but names no shop`);
    await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).for("no key update");
    return;
  }
  switch (capabilitySubject(purpose)) {
    case "user_account":
      await db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(eq(userAccounts.id, subjectId))
        .for("update");
      return;
    case "person":
      await db
        .select({ id: people.id })
        .from(people)
        // diveday:allow-deleted-people: a lock on the row the caller already proved, by id; it reads nothing.
        .where(eq(people.id, subjectId))
        .for("no key update");
      return;
    default:
      throw new Error(`${purpose} supersedes per subject, which has no row to lock`);
  }
}

/** `issueCapability`, also returning the row's id (a delivery records which link it carried). */
export async function mintCapability<P extends CapabilityPurpose>(
  db: DbExecutor,
  input: IssueCapabilityInput<P>,
): Promise<{ token: string; id: string; expiresAt: Date | null }> {
  const policy: CapabilityPolicy = CAPABILITY_POLICY[input.purpose];
  const shopId: string | null = input.shopId;
  // The table refuses the wrong shape too; this names the caller's mistake.
  if ((policy.scope === "platform") !== (shopId === null)) {
    throw new Error(`${input.purpose} is a ${policy.scope} purpose`);
  }
  const now = input.now ?? nowDate();
  const expiresAt = capabilityExpiry(input.purpose, now);
  const columns = subjectColumns(input.purpose, input.subjectId);
  if (policy.reissue === "supersedes") {
    // The invariant (one live link per shop, or per subject, per purpose)
    // belongs to this module, not to its callers.
    await lockForSupersede(db, input.purpose, policy.per, shopId, input.subjectId);
    await db
      .update(capabilities)
      .set({ revokedAt: now })
      .where(
        and(
          eq(capabilities.purpose, input.purpose),
          policy.per === "shop"
            ? eq(capabilities.shopId, shopId as string)
            : eq(subjectColumn(input.purpose), input.subjectId),
          isNull(capabilities.usedAt),
          isNull(capabilities.revokedAt),
        ),
      );
  }
  const token = createBearerToken();
  const [row] = await db
    .insert(capabilities)
    .values({
      purpose: input.purpose,
      shopId,
      ...columns,
      tokenHash: hashBearerToken(token),
      issuedAt: now,
      expiresAt,
    })
    .returning({ id: capabilities.id });
  if (!row) throw new Error(`Failed to issue a ${input.purpose} capability`);
  return { token, id: row.id, expiresAt };
}

export type VerifiedCapability<P extends CapabilityPurpose = CapabilityPurpose> = {
  id: string;
  /** The row's own shop; null exactly on a `platform` purpose. */
  shopId: CapabilityShop<P>;
  /**
   * The value in the purpose's subject column (`CAPABILITY_POLICY[purpose].subject`):
   * an id, or for a `shop_address` purpose the lower-cased address.
   */
  subjectId: string;
  /** When a purpose a use spends was spent; always null for an idempotent one. */
  usedAt: Date | null;
  /** A purpose that expires: its deadline. Null for one that never does. */
  expiresAt: Date | null;
  /** When a newer link superseded this one. */
  revokedAt: Date | null;
};

/**
 * The row a token names, **for this purpose only**, or null. The purpose is in
 * the predicate, so a token minted for one purpose reads as unknown under every
 * other one: a courtesy-email link cannot close a last-minute interest, and the
 * reverse. Null covers an unknown token and a wrong purpose alike, so a caller
 * cannot tell the two apart and neither can whoever holds the link.
 *
 * It answers for a spent, revoked or expired link too, so a page can say
 * "already done" or "no longer available"; `openCapability` and
 * `spendCapability` are the gates that act on a live link only.
 *
 * The returned `shopId` is the row's own. A caller that joins its subject must
 * still check the subject is in that shop before trusting it.
 */
export async function verifyCapability<P extends CapabilityPurpose>(
  db: DbExecutor,
  input: { purpose: P; token: string },
): Promise<VerifiedCapability<P> | null> {
  const [row] = await db
    .select(ROW)
    .from(capabilities)
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
      ),
    )
    .limit(1);
  return row ? verified(input.purpose, row) : null;
}

/**
 * The row a token names for this purpose **while it still works**: not spent,
 * not revoked, not expired. Null for anything else, one answer for all of
 * them. Read-only: a page decides from it what to render, and the action that
 * does what the link does spends it with `spendCapability`.
 */
export async function openCapability<P extends CapabilityPurpose>(
  db: DbExecutor,
  input: { purpose: P; token: string; now?: Date },
): Promise<VerifiedCapability<P> | null> {
  const [row] = await db
    .select(ROW)
    .from(capabilities)
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        isNull(capabilities.usedAt),
        unrevokedAndUnexpired(input.now ?? nowDate()),
      ),
    )
    .limit(1);
  return row ? verified(input.purpose, row) : null;
}

/**
 * Spends a capability whose purpose a use spends (`use: "once"`): marks it
 * used in one conditional update and returns it, or null for an unknown
 * token, a wrong purpose, or a link already spent, revoked or expired. Two
 * opens at once spend it once. Call it inside the transaction that does what
 * the link does, so a refusal there rolls the spend back.
 *
 * `alsoRequire` is a further condition on the row, checked in the same
 * update (the account a token names is not disabled): a spend that then
 * checks could act on a state that changed in between, and burn the link for
 * nothing when it refuses.
 */
export async function spendCapability<P extends CapabilityPurpose>(
  db: DbExecutor,
  input: { purpose: P; token: string; now?: Date; alsoRequire?: SQL },
): Promise<VerifiedCapability<P> | null> {
  if (CAPABILITY_POLICY[input.purpose].use !== "once") {
    throw new Error(`${input.purpose} is not spent by a use`);
  }
  const now = input.now ?? nowDate();
  const [row] = await db
    .update(capabilities)
    .set({ usedAt: now })
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        isNull(capabilities.usedAt),
        unrevokedAndUnexpired(now),
        input.alsoRequire,
      ),
    )
    .returning(ROW);
  return row ? verified(input.purpose, row) : null;
}

/**
 * Withdraws every unspent link of one purpose a shop holds: for a
 * `shop_address` purpose whose address the shop just changed or cleared, so a
 * link mailed to the old address opens nothing (it reads as unknown), or every
 * link but the newest delivered one (`except`). A spent link stays, so it
 * still reads as "already done". Returns how many went.
 */
export async function withdrawUnspentCapabilities(
  db: DbExecutor,
  input: { purpose: CapabilityPurpose; shopId: string; except?: string },
): Promise<number> {
  const withdrawn = await db
    .delete(capabilities)
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.shopId, input.shopId),
        isNull(capabilities.usedAt),
        input.except ? ne(capabilities.tokenHash, hashBearerToken(input.except)) : undefined,
      ),
    )
    .returning({ id: capabilities.id });
  return withdrawn.length;
}
