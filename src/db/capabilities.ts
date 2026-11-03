import { and, eq } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { type CapabilityPurpose, capabilitySubject } from "@/lib/capabilities";
import type { DbExecutor } from "./client";
import { capabilities } from "./schema";

/**
 * The `capabilities` table's rows and the transitions on them (issue #2710):
 * mint one, and verify one for a named purpose. The policy each purpose follows
 * is `CAPABILITY_POLICY` in `src/lib/capabilities.ts`; this module reads the
 * subject from it and nothing else, so a caller never chooses which column its
 * subject id lands in.
 *
 * What a capability opens, and what opening it does, stays with the thing it
 * opens (`src/db/interests.ts`, `src/db/courtesy-email.ts`): those modules call
 * `verifyCapability` with their own purpose and then read their own subject.
 */

function subjectColumns(purpose: CapabilityPurpose, subjectId: string) {
  return capabilitySubject(purpose) === "interest"
    ? { interestId: subjectId, personId: null }
    : { personId: subjectId, interestId: null };
}

/**
 * Mints a fresh capability and returns the token, which is shown once and
 * never stored: the row keeps only its digest. Each call is a new link; an
 * earlier link for the same subject keeps working.
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
  /** The id in the purpose's subject column (`CAPABILITY_POLICY[purpose].subject`). */
  subjectId: string;
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
    .select({
      id: capabilities.id,
      shopId: capabilities.shopId,
      personId: capabilities.personId,
      interestId: capabilities.interestId,
    })
    .from(capabilities)
    .where(
      and(
        eq(capabilities.purpose, input.purpose),
        eq(capabilities.tokenHash, hashBearerToken(input.token)),
      ),
    )
    .limit(1);
  if (!row) return null;
  const subjectId = capabilitySubject(input.purpose) === "interest" ? row.interestId : row.personId;
  // The table's check makes this unreachable; a null subject must still never
  // be handed on as an id.
  if (!subjectId) return null;
  return { id: row.id, shopId: row.shopId, subjectId };
}
