import { and, eq, inArray, isNull } from "drizzle-orm";
import { splitCardsByKind } from "@/lib/card-ledger";
import type { TripAdmissionEvidence } from "@/lib/trip-admission";
import type { DbExecutor } from "./client";
import { cards } from "./schema";

/**
 * **One diver's live cert evidence at this shop** — the same rows readiness
 * reads, and the only thing `decideTripAdmission` is ever handed.
 *
 * The booking transaction and the recap's next-dive card (`src/features/next-dive/store.ts`)
 * both read it, so "what this shop knows about this diver's cards" is written
 * once and one surface cannot admit what another refuses. One statement over
 * the card ledger (issue #2722), sorted into the three lists the gates take.
 *
 * A `DbExecutor` rather than an `AppDb`: the booking path calls it inside its
 * own transaction.
 */
export async function readCertificationEvidence(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<TripAdmissionEvidence> {
  const rows = await tx
    .select()
    .from(cards)
    .where(and(eq(cards.shopId, shopId), eq(cards.personId, personId), isNull(cards.deletedAt)));
  return splitCardsByKind(rows);
}

/**
 * **Many divers' live cert evidence at this shop, in one statement**: the same
 * filters as {@link readCertificationEvidence}, over a list of people, keyed by
 * person. A person with no rows gets empty lists, which is what the one-person
 * read returns for them. For a surface that weighs a list of candidates against
 * one departure (the invite suggestions).
 */
export async function readCertificationEvidenceFor(
  tx: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, TripAdmissionEvidence>> {
  const byPerson = new Map<string, TripAdmissionEvidence>();
  if (personIds.length === 0) return byPerson;
  const ids = [...new Set(personIds)];
  const rows = await tx
    .select()
    .from(cards)
    .where(and(eq(cards.shopId, shopId), inArray(cards.personId, ids), isNull(cards.deletedAt)));
  for (const id of ids) {
    byPerson.set(id, splitCardsByKind(rows.filter((row) => row.personId === id)));
  }
  return byPerson;
}
