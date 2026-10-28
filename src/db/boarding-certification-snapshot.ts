import { and, eq, type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";
import {
  certifications,
  nitroxCertifications,
  people,
  rollCallEvents,
  specialtyCertifications,
} from "./schema";

/**
 * A per-shop transaction lock serializes person merge/erasure with shared
 * writers of name-bearing evidence, including boarding captures and retained
 * crew notes, before their person or booking locks. Shared writers do not block
 * one another. A note ordered after an erasure's exclusive lock may introduce
 * a name again; the erasure sweep covers notes persisted before it completes.
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

type Cards = typeof certifications | typeof specialtyCertifications | typeof nitroxCertifications;

/**
 * One INSERT statement reads all card tables and reviewer names from one
 * READ COMMITTED database snapshot. The shop advisory lock prevents merge or
 * erasure until this transaction commits; this must not run in an outer
 * REPEATABLE READ transaction whose snapshot predates that lock.
 */
export function boardingCertificationSnapshot(shopId: string, personId: string): SQL {
  const cards = (table: Cards, kind: string, level: SQL, specialty: SQL, selfDeclared: SQL) => sql`
    select jsonb_build_object(
      'kind', ${kind}::text, 'agency', ${table.agency}, 'level', ${level}, 'specialty', ${specialty},
      'identifier', ${table.identifier}, 'status', ${table.status},
      'reviewedAt', case when ${table.reviewedAt} is null then null else
        to_char(${table.reviewedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'reviewedByPersonId', reviewer.id, 'reviewedByName', reviewer.full_name,
      'imported', ${table.importedAt} is not null, 'selfDeclared', ${selfDeclared}
    ) as card
    from ${table}
    left join ${people} as reviewer on reviewer.id = ${table.reviewedByPersonId}
      and reviewer.shop_id = ${shopId} and reviewer.anonymized_at is null
    where ${table.shopId} = ${shopId} and ${table.personId} = ${personId}
      and ${table.deletedAt} is null`;
  const unsighted = (table: typeof certifications | typeof nitroxCertifications) =>
    sql`${table.selfDeclaredAt} is not null and ${table.status} = 'pending'`;
  return sql`(
    select coalesce(jsonb_agg(card order by card ->> 'kind', card ->> 'agency',
      card ->> 'level', card ->> 'specialty', card ->> 'identifier'), '[]'::jsonb)
    from (
      ${cards(certifications, "level", sql`${certifications.level}`, sql`null`, unsighted(certifications))}
      union all
      ${cards(specialtyCertifications, "specialty", sql`null`, sql`${specialtyCertifications.specialty}`, sql`false`)}
      union all
      ${cards(nitroxCertifications, "nitrox", sql`null`, sql`null`, unsighted(nitroxCertifications))}
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
