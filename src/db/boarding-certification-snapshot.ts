import { and, eq, type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";
import { cards, people, rollCallEvents } from "./schema";

/**
 * A per-shop transaction lock serializes person merge/erasure with shared
 * writers of name-bearing evidence, including boarding captures and crew notes,
 * before their person or booking locks. Shared writers do not block one another.
 * Offline crew-note sync also compares its authenticated snapshot epoch under
 * this fence: a pre-erasure queued note keeps its roll-call mark but drops its
 * text, while a fresh post-erasure snapshot may submit a new note. Live notes
 * remain allowed after erasure by product decision.
 * The namespace is distinct from other advisory locks; hash collisions only
 * serialize unrelated shops, never weaken isolation.
 */
export async function lockBoardingCertificationEvidence(
  tx: DbExecutor,
  shopId: string,
  mode: "boarding" | "rewrite",
): Promise<void> {
  await boundLockWaits(tx);
  if (mode === "boarding") {
    const isolation = await tx.execute(
      sql`select current_setting('transaction_isolation') as isolation`,
    );
    if ((isolation.rows[0] as { isolation: string } | undefined)?.isolation !== "read committed") {
      throw new Error("Boarding certification capture requires a READ COMMITTED transaction");
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(hashtext('boarding_certification_evidence'), hashtext(${shopId}))`,
    );
  } else {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('boarding_certification_evidence'), hashtext(${shopId}))`,
    );
  }
}

/**
 * One INSERT statement reads every card of every kind (the snapshot is the
 * diver's whole ledger, so it names no kind) and reviewer names from one
 * READ COMMITTED database snapshot. The shop advisory lock prevents merge or
 * erasure until this transaction commits; this must not run in an outer
 * REPEATABLE READ transaction whose snapshot predates that lock.
 */
export function boardingCertificationSnapshot(shopId: string, personId: string): SQL {
  // A still-unsighted claim, of any kind: a specialty a diver typed on /ready
  // is as much a claim as a level they typed, and the record says so.
  const selfDeclared = sql`${cards.selfDeclaredAt} is not null and ${cards.status} = 'pending'`;
  return sql`(
    select coalesce(jsonb_agg(card order by card ->> 'kind', card ->> 'agency',
      card ->> 'level', card ->> 'specialty', card ->> 'identifier'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'kind', ${cards.kind}::text, 'agency', ${cards.agency}, 'level', ${cards.level},
        'specialty', ${cards.specialty},
        'identifier', ${cards.identifier}, 'status', ${cards.status},
        'reviewedAt', case when ${cards.reviewedAt} is null then null else
          to_char(${cards.reviewedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'reviewedByPersonId', reviewer.id, 'reviewedByName', reviewer.full_name,
        'imported', ${cards.importedAt} is not null, 'selfDeclared', ${selfDeclared}
      ) as card
      from ${cards}
      left join ${people} as reviewer on reviewer.id = ${cards.reviewedByPersonId}
        and reviewer.shop_id = ${shopId} and reviewer.anonymized_at is null
      where ${cards.shopId} = ${shopId} and ${cards.personId} = ${personId}
        and ${cards.deletedAt} is null
    ) as evidence
  )`;
}

/** Repoint an embedded reviewer after merge, or erase both identifier and name. */
export async function rewriteBoardingSnapshotReviewer(
  db: DbExecutor,
  shopId: string,
  fromPersonId: string,
  toPersonId: string | null,
): Promise<void> {
  const patch =
    toPersonId === null
      ? { reviewedByPersonId: null, reviewedByName: null }
      : { reviewedByPersonId: toPersonId };
  await db
    .update(rollCallEvents)
    .set({
      certificationSnapshot: sql`(
      select jsonb_agg(case when card ->> 'reviewedByPersonId' = ${fromPersonId}
        then card || ${JSON.stringify(patch)}::jsonb else card end order by ordinal)
      from jsonb_array_elements(${rollCallEvents.certificationSnapshot}) with ordinality as item(card, ordinal)
    )`,
    })
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        sql`${rollCallEvents.certificationSnapshot} @> ${JSON.stringify([{ reviewedByPersonId: fromPersonId }])}::jsonb`,
      ),
    );
}
