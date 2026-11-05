import { and, eq, isNull, ne } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { CAPABILITY_POLICY, type CapabilityPurpose, capabilitySubject } from "@/lib/capabilities";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { capabilities } from "./schema";

/**
 * The `capabilities` table's rows and the transitions on them (issue #2710):
 * mint one, verify one for a named purpose, and spend one whose purpose a use
 * spends. The policy each purpose follows
 * is `CAPABILITY_POLICY` in `src/lib/capabilities.ts`; this module reads the
 * subject from it and nothing else, so a caller never chooses which column its
 * subject id lands in.
 *
 * What a capability opens, and what opening it does, stays with the thing it
 * opens (`src/db/interests.ts`, `src/db/courtesy-email.ts`): those modules call
 * `verifyCapability` with their own purpose and then read their own subject.
 */

function subjectColumns(purpose: CapabilityPurpose, subjectId: string) {
  switch (capabilitySubject(purpose)) {
    case "interest":
      return { interestId: subjectId, personId: null, sentTo: null };
    case "person":
      return { personId: subjectId, interestId: null, sentTo: null };
    case "shop_address":
      return { sentTo: subjectId.trim().toLowerCase(), personId: null, interestId: null };
  }
}

type CapabilityRow = {
  id: string;
  shopId: string;
  personId: string | null;
  interestId: string | null;
  sentTo: string | null;
  usedAt: Date | null;
};

const ROW = {
  id: capabilities.id,
  shopId: capabilities.shopId,
  personId: capabilities.personId,
  interestId: capabilities.interestId,
  sentTo: capabilities.sentTo,
  usedAt: capabilities.usedAt,
};

function verified(purpose: CapabilityPurpose, row: CapabilityRow): VerifiedCapability | null {
  const subject = capabilitySubject(purpose);
  const subjectId =
    subject === "interest" ? row.interestId : subject === "person" ? row.personId : row.sentTo;
  // The table's check makes this unreachable; a null subject must still never
  // be handed on as an id.
  if (!subjectId) return null;
  return { id: row.id, shopId: row.shopId, subjectId, usedAt: row.usedAt };
}

/**
 * Mints a fresh capability and returns the token, which is shown once and
 * never stored: the row keeps only its digest. Each call is a new link; an
 * earlier link for the same subject keeps working. For a `shop_address`
 * purpose `subjectId` is the address the link is mailed to.
 */
export async function issueCapability(
  db: DbExecutor,
  input: { purpose: CapabilityPurpose; shopId: string; subjectId: string },
): Promise<string> {
  const token = createBearerToken();
  await db.insert(capabilities).values({
    purpose: input.purpose,
    shopId: input.shopId,
    ...subjectColumns(input.purpose, input.subjectId),
    tokenHash: hashBearerToken(token),
  });
  return token;
}

export type VerifiedCapability = {
  id: string;
  shopId: string;
  /**
   * The value in the purpose's subject column (`CAPABILITY_POLICY[purpose].subject`):
   * an id, or for a `shop_address` purpose the lower-cased address.
   */
  subjectId: string;
  /** When a purpose a use spends was spent; always null for an idempotent one. */
  usedAt: Date | null;
};

/**
 * The row a token names, **for this purpose only**, or null. The purpose is in
 * the predicate, so a token minted for one purpose reads as unknown under every
 * other one: a courtesy-email link cannot close a last-minute interest, and the
 * reverse. Null covers an unknown token and a wrong purpose alike, so a caller
 * cannot tell the two apart and neither can whoever holds the link.
 *
 * The returned `shopId` is the row's own. A caller that joins its subject must
 * still check the subject is in that shop before trusting it.
 */
export async function verifyCapability(
  db: DbExecutor,
  input: { purpose: CapabilityPurpose; token: string },
): Promise<VerifiedCapability | null> {
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
 * Spends a capability whose purpose a use spends (`use: "once"`): marks it
 * used in one conditional update and returns it, or null for an unknown
 * token, a wrong purpose or a link already spent. Two opens at once spend it
 * once. Call it inside the transaction that does what the link does, so a
 * refusal there rolls the spend back.
 */
export async function spendCapability(
  db: DbExecutor,
  input: { purpose: CapabilityPurpose; token: string; now?: Date },
): Promise<VerifiedCapability | null> {
  if (CAPABILITY_POLICY[input.purpose].use !== "once") {
    throw new Error(`${input.purpose} is not spent by a use`);
  }
  const [row] = await db
    .update(capabilities)
    .set({ usedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
        isNull(capabilities.usedAt),
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
