import { and, eq, type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { isDemoShopWithDemoOwnerOrCaptainAccount } from "./demo-account-guard";
import { boundLockWaits } from "./lock-bounds";
import { isTransactionExecutor } from "./query-helpers";
import { seatMarks } from "./roll-call-subject";
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
 * Attempt the existing erasure/reset fence without waiting behind a rewrite.
 * This only coordinates participating writers. It is not authorization, a
 * durable receipt, a device acknowledgement, or a reset-preservation policy.
 * No production intake calls this while the receipt contract is incomplete.
 * Call before any person, booking, or schedule lock, then re-read live
 * authorization and subject state within the same READ COMMITTED transaction.
 */
export async function tryLockBoardingEvidenceForReceipt(
  tx: DbExecutor,
  shopId: string,
): Promise<boolean> {
  if (!isTransactionExecutor(tx)) throw new Error("Receipt fence requires a transaction");
  const isolation = await tx.execute(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  if ((isolation.rows[0] as { isolation: string } | undefined)?.isolation !== "read committed") {
    throw new Error("Receipt fence requires a READ COMMITTED transaction");
  }
  const result = await tx.execute(sql`select pg_try_advisory_xact_lock_shared(
    hashtext('boarding_certification_evidence'), hashtext(${shopId})) as acquired`);
  return (result.rows[0] as { acquired: boolean } | undefined)?.acquired === true;
}

/**
 * Proposed first step for an eventual coordinated demo reset. The caller must
 * pass a fresh transaction with no earlier shop, account, person, or booking
 * locks; this function cannot detect locks already taken by its caller.
 *
 * A true result is only the existing demo identity gate under these locks. It
 * is not authorization to delete or proof that a booking or device event is
 * preserved. Current reset, reap, revocation and older servers do not all use
 * this order, and the exclusive fence prevents prompt intake while held. No
 * production path calls this helper while the receipt contract is incomplete.
 */
export async function lockDemoResetEvidenceFirst(tx: DbExecutor, shopId: string): Promise<boolean> {
  if (!isTransactionExecutor(tx)) throw new Error("Coordinated demo gate requires a transaction");
  const isolation = await tx.execute(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  if ((isolation.rows[0] as { isolation: string } | undefined)?.isolation !== "read committed") {
    throw new Error("Coordinated demo gate requires a READ COMMITTED transaction");
  }
  await lockBoardingCertificationEvidence(tx, shopId, "rewrite");
  return isDemoShopWithDemoOwnerOrCaptainAccount(tx, shopId);
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
        seatMarks(),
        sql`${rollCallEvents.certificationSnapshot} @> ${JSON.stringify([{ reviewedByPersonId: fromPersonId }])}::jsonb`,
      ),
    );
}
