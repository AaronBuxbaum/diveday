import { and, eq, type SQL, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import {
  certifications,
  nitroxCertifications,
  people,
  rollCallEvents,
  specialtyCertifications,
} from "./schema";

type Cards = typeof certifications | typeof specialtyCertifications | typeof nitroxCertifications;

/**
 * One INSERT statement reads all card tables from one database snapshot.
 * Reviewer rows are held through commit so concurrent erasure cannot scrub
 * before this snapshot is inserted and leave the reviewer's old name behind.
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
    left join lateral (
      select id, full_name from ${people}
      where id = ${table.reviewedByPersonId} and shop_id = ${shopId}
        and anonymized_at is null
      for share
    ) as reviewer on true
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
