import { and, eq, gt, inArray, isNotNull, isNull, ne, or, type SQL } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import {
  CAPABILITY_POLICY,
  type CapabilityPolicy,
  type CapabilityPurpose,
  capabilityExpiry,
  capabilitySubject,
  onePerPersonPurposes,
  purposesNaming,
  reusablePurposes,
} from "@/lib/capabilities";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { capabilities, people, shops, userAccounts, waiverRecords } from "./schema";

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
  const none = {
    interestId: null,
    personId: null,
    sentTo: null,
    userAccountId: null,
    setupRequestId: null,
    waiverRecordId: null,
  };
  switch (capabilitySubject(purpose)) {
    case "interest":
      return { ...none, interestId: subjectId };
    case "person":
      return { ...none, personId: subjectId };
    case "shop_address":
      return { ...none, sentTo: subjectId.trim().toLowerCase() };
    case "user_account":
      return { ...none, userAccountId: subjectId };
    case "setup_request":
      return { ...none, setupRequestId: subjectId };
    case "waiver_record":
      return { ...none, waiverRecordId: subjectId };
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
    case "setup_request":
      return capabilities.setupRequestId;
    case "waiver_record":
      return capabilities.waiverRecordId;
  }
}

type CapabilityRow = {
  id: string;
  shopId: string | null;
  personId: string | null;
  interestId: string | null;
  sentTo: string | null;
  userAccountId: string | null;
  setupRequestId: string | null;
  waiverRecordId: string | null;
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
  setupRequestId: capabilities.setupRequestId,
  waiverRecordId: capabilities.waiverRecordId,
  usedAt: capabilities.usedAt,
  expiresAt: capabilities.expiresAt,
  revokedAt: capabilities.revokedAt,
};

function verified<P extends CapabilityPurpose>(
  purpose: P,
  row: CapabilityRow,
): VerifiedCapability<P> | null {
  const subjectId = {
    interest: row.interestId,
    person: row.personId,
    shop_address: row.sentTo,
    user_account: row.userAccountId,
    setup_request: row.setupRequestId,
    waiver_record: row.waiverRecordId,
  }[capabilitySubject(purpose)];
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

/**
 * A link to a release names a release of its own shop: the record has no
 * composite key with the row's shop, so a release of another shop is refused
 * here. The signing writer takes this row after the person and the seat, as
 * the mint's caller has.
 */
async function lockReleaseInShop(
  db: DbExecutor,
  purpose: CapabilityPurpose,
  shopId: string | null,
  recordId: string,
): Promise<void> {
  if (!shopId) throw new Error(`${purpose} names no shop`);
  const [record] = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.id, recordId), eq(waiverRecords.shopId, shopId)))
    .for("no key update");
  if (!record) throw new Error(`${purpose} names a release outside its shop`);
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
  if (capabilitySubject(input.purpose) === "waiver_record") {
    // A release's links add (a resend never closes the one a diver is signing
    // on); the signature through any one leaves the others opening nothing.
    await lockReleaseInShop(db, input.purpose, shopId, input.subjectId);
  }
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
      oneLive: onePerPersonPurposes().includes(input.purpose),
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
  /** When the link was turned off (a newer one superseded it, a contact changed). */
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
 * `openCapability` over several purposes that name the same kind of subject
 * (the two calendar feeds), for a token whose purpose the holder does not say:
 * the live row it names under any of them, with that purpose, or null.
 */
export async function openCapabilityAmong<P extends CapabilityPurpose>(
  db: DbExecutor,
  input: { purposes: readonly P[]; token: string; now?: Date },
): Promise<(VerifiedCapability<P> & { purpose: P }) | null> {
  if (input.purposes.length === 0) return null;
  const [row] = await db
    .select({ ...ROW, purpose: capabilities.purpose })
    .from(capabilities)
    .where(
      and(
        inArray(capabilities.purpose, [...input.purposes]),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        isNull(capabilities.usedAt),
        unrevokedAndUnexpired(input.now ?? nowDate()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const purpose = row.purpose as P;
  const live = verified(purpose, row);
  return live ? { ...live, purpose } : null;
}

/**
 * Stamps a reusable capability's last successful use (`last_accessed_at`).
 * Only a `use: "reusable"` purpose carries the column, so any other row is
 * left alone.
 */
export async function touchCapability(
  db: DbExecutor,
  input: { id: string; now?: Date },
): Promise<void> {
  await db
    .update(capabilities)
    .set({ lastAccessedAt: input.now ?? nowDate() })
    .where(and(eq(capabilities.id, input.id), inArray(capabilities.purpose, reusablePurposes())));
}

export type LiveCapability<P extends CapabilityPurpose> = {
  id: string;
  purpose: P;
  issuedAt: Date;
  lastAccessedAt: Date | null;
};

/** The live (unspent, unrevoked, unexpired) links of these purposes one person holds in a shop. */
export async function livePersonCapabilities<P extends CapabilityPurpose>(
  db: DbExecutor,
  input: { purposes: readonly P[]; shopId: string; personId: string; now?: Date },
): Promise<LiveCapability<P>[]> {
  if (input.purposes.length === 0) return [];
  const rows = await db
    .select({
      id: capabilities.id,
      purpose: capabilities.purpose,
      issuedAt: capabilities.issuedAt,
      lastAccessedAt: capabilities.lastAccessedAt,
    })
    .from(capabilities)
    .where(
      and(
        inArray(capabilities.purpose, [...input.purposes]),
        eq(capabilities.shopId, input.shopId),
        eq(capabilities.personId, input.personId),
        isNull(capabilities.usedAt),
        unrevokedAndUnexpired(input.now ?? nowDate()),
      ),
    );
  return rows.map((row) => ({ ...row, purpose: row.purpose as P }));
}

/**
 * Turns off the live links of these purposes in one shop (`revoked_at`),
 * without minting replacements, for one person (`personId`). A revoked row stays, so the fact that it
 * was turned off stays on record. A `person` purpose's rows only.
 */
export async function revokePersonCapabilities(
  db: DbExecutor,
  input: {
    purposes: readonly CapabilityPurpose[];
    shopId: string;
    personId: string;
    now?: Date;
  },
): Promise<void> {
  if (input.purposes.length === 0) return;
  for (const purpose of input.purposes) {
    if (capabilitySubject(purpose) !== "person") throw new Error(`${purpose} names no person`);
  }
  await db
    .update(capabilities)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      and(
        inArray(capabilities.purpose, [...input.purposes]),
        eq(capabilities.shopId, input.shopId),
        isNull(capabilities.revokedAt),
        eq(capabilities.personId, input.personId),
      ),
    );
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
 * Claims a link for the first device that opens it (`claim: "first_device"`):
 * stores the digest of a fresh secret in one conditional update and returns
 * the secret, for the device to keep in a cookie, or null for an unknown
 * token, a wrong purpose, or a link already claimed, spent, revoked or
 * expired. Two claims at once, one wins.
 */
export async function claimCapability(
  db: DbExecutor,
  input: { purpose: CapabilityPurpose; token: string; now?: Date },
): Promise<string | null> {
  const policy: CapabilityPolicy = CAPABILITY_POLICY[input.purpose];
  if (policy.claim !== "first_device") throw new Error(`${input.purpose} is not claimed`);
  const device = createBearerToken();
  const [row] = await db
    .update(capabilities)
    .set({ claimHash: hashBearerToken(device) })
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        isNull(capabilities.claimHash),
        isNull(capabilities.usedAt),
        unrevokedAndUnexpired(input.now ?? nowDate()),
      ),
    )
    .returning({ id: capabilities.id });
  return row ? device : null;
}

/**
 * Who a claimable link opens for: nobody has claimed it yet (`unclaimed`),
 * the device holding `device` did (`this_device`), or another one did
 * (`elsewhere`). Null for a token that names no link of this purpose.
 */
export async function capabilityClaim(
  db: DbExecutor,
  input: { purpose: CapabilityPurpose; token: string; device: string | undefined },
): Promise<"unclaimed" | "this_device" | "elsewhere" | null> {
  const [row] = await db
    .select({ claimHash: capabilities.claimHash })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.claimHash === null) return "unclaimed";
  return input.device && hashBearerToken(input.device) === row.claimHash
    ? "this_device"
    : "elsewhere";
}

/**
 * Records the shop a spent setup link opened (`spent_by_shop_id`, which the
 * table allows on `shop_setup` only), in the transaction that spent it and
 * created the shop. Returns the request the link was minted for, or null for a
 * token that names no spent setup link.
 */
export async function recordSetupLinkSpentBy(
  db: DbExecutor,
  input: { token: string; shopId: string },
): Promise<{ setupRequestId: string } | null> {
  const [row] = await db
    .update(capabilities)
    .set({ spentByShopId: input.shopId })
    .where(
      and(
        eq(capabilities.purpose, "shop_setup"),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        isNotNull(capabilities.usedAt),
      ),
    )
    .returning({ setupRequestId: capabilities.setupRequestId });
  return row?.setupRequestId ? { setupRequestId: row.setupRequestId } : null;
}

/**
 * Withdraws every unspent link of one purpose a shop holds: for a
 * `shop_address` purpose whose address the shop just changed or cleared, so a
 * link mailed to the old address opens nothing (it reads as unknown), or every
 * link but the newest delivered one (`except`), or just the one link named
 * (`only`). A spent link stays, so it still reads as "already done". Returns
 * how many went.
 */
export async function withdrawUnspentCapabilities(
  db: DbExecutor,
  input: { purpose: CapabilityPurpose; shopId: string; except?: string; only?: string },
): Promise<number> {
  // An empty name read as no name, and withdrew every link of the purpose
  // (security review of rda-3950, N2).
  if (input.only === "" || input.except === "") {
    throw new Error("withdrawUnspentCapabilities: an empty link names nothing");
  }
  const withdrawn = await db
    .delete(capabilities)
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.shopId, input.shopId),
        isNull(capabilities.usedAt),
        input.except !== undefined
          ? ne(capabilities.tokenHash, hashBearerToken(input.except))
          : undefined,
        input.only !== undefined
          ? eq(capabilities.tokenHash, hashBearerToken(input.only))
          : undefined,
      ),
    )
    .returning({ id: capabilities.id });
  return withdrawn.length;
}

/**
 * Turns off every live link to one person's releases (`revoked_at`), whatever
 * its purpose: the counter link and the release link (issue #3983). A
 * corrected contact calls it, so a link that went to the old address, or was
 * handed over before the correction, opens nothing: not a form, and not the
 * receipt of a release it already signed. A revoked row stays, so the page
 * can still land its bearer on the rescue, which sends only to the new
 * contact.
 */
export async function revokePersonReleaseLinks(
  db: DbExecutor,
  input: { shopId: string; personId: string; now?: Date },
): Promise<void> {
  await db
    .update(capabilities)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      and(
        inArray(capabilities.purpose, purposesNaming("waiver_record")),
        eq(capabilities.shopId, input.shopId),
        isNull(capabilities.revokedAt),
        inArray(
          capabilities.waiverRecordId,
          db
            .select({ id: waiverRecords.id })
            .from(waiverRecords)
            .where(
              and(
                eq(waiverRecords.shopId, input.shopId),
                eq(waiverRecords.personId, input.personId),
              ),
            ),
        ),
      ),
    );
}
