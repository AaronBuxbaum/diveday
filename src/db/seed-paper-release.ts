import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { people } from "./schema";

/** How long after a diver signs the counter finishes the record. */
const COUNTER_LAG_MS = 3 * 60_000;

/**
 * **A paper release as the counter writes it** (issue #2684): the fields a
 * seeded signed waiver shares, so no seed names the method itself. The method
 * is `in_person_attested`, a named staffer recorded it, and the signature is
 * the diver's own full name, exactly what `recordInPersonWaiver` stores. The
 * record completes a few minutes after the diver signed, as it does at a
 * counter.
 */
export function paperRelease(signedAt: Date, recordedByPersonId: string, signedName: string) {
  return {
    status: "completed" as const,
    signedName,
    signatureMethod: "in_person_attested" as const,
    recordedByPersonId,
    consentedAt: signedAt,
    signedAt,
    completedAt: new Date(signedAt.getTime() + COUNTER_LAG_MS),
  };
}

/** A shop's people by id, for the name a diver signs a paper release with. */
export async function signingNames(
  db: DbExecutor,
  shopId: string,
): Promise<(id: string) => string> {
  const rows = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(eq(people.shopId, shopId));
  const names = new Map(rows.map((row) => [row.id, row.fullName]));
  return (id) => {
    const name = names.get(id);
    if (!name) throw new Error(`seed: no name to sign a paper release for ${id}`);
    return name;
  };
}
