import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { waiverIntegrityVerdict } from "@/lib/waiver-integrity";
import type { DbExecutor } from "./client";
import { waiverRecords } from "./schema";
import { WAIVER_SEALED_COLUMNS } from "./waiver-record-columns";

/** Rows read and re-checked per statement. */
export const WAIVER_SEAL_CHECK_BATCH = 200;
/** Rows one nightly pass re-checks at most; the rest wait for the next night, oldest first. */
export const WAIVER_SEAL_CHECK_LIMIT = 4_000;

export type WaiverSealCheckSummary = {
  /** Sealed releases whose verdict this pass re-wrote. */
  checked: number;
  /** Of those, how many failed verification. */
  invalid: number;
  /** Of those, how many passed (or had never been checked) the last time: a seal that broke since. */
  newlyInvalid: number;
  /** True when the pass stopped at its limit with sealed releases still unchecked tonight. */
  capped: boolean;
};

/**
 * **The nightly re-check of every signed release's seal** (issue #2562),
 * across every shop: recomputes `verifyWaiverIntegrity` and re-writes the
 * cached verdict (`integrity_valid`, `integrity_checked_at`) that the signature
 * log's "Can’t be checked" view filters on. A seal is written with a verdict
 * (`waiverIntegrityVerdict`), so this pass exists for the edit nobody made
 * through DiveDay: a row changed straight in the database reads `invalid` on
 * every page that shows it at once, and lands in the view by the next pass.
 *
 * Only a row with both a hash and a seal version: one missing either is
 * `unsealed`, which the view already finds by its nulls. Oldest verdict first
 * (never-checked before all), and only rows checked before `now`, so a row is
 * read once per pass and a large log is covered over several nights rather
 * than in one run past the function's time limit.
 *
 * Each verdict is written only while the row still carries the hash and
 * version it was read with. A re-seal that lands between the read and the
 * write (a merge's refile, an erasure) writes its own verdict, and this pass
 * never overwrites it with one about the row before. Reads and writes ids,
 * hashes and booleans; never a diver's name or a medical answer leaves it.
 */
export async function recheckWaiverSeals(
  db: DbExecutor,
  options: { now: Date; batchSize?: number; limit?: number },
): Promise<WaiverSealCheckSummary> {
  const batchSize = options.batchSize ?? WAIVER_SEAL_CHECK_BATCH;
  const limit = options.limit ?? WAIVER_SEAL_CHECK_LIMIT;
  const summary: WaiverSealCheckSummary = {
    checked: 0,
    invalid: 0,
    newlyInvalid: 0,
    capped: false,
  };
  const due = and(
    isNotNull(waiverRecords.integrityHash),
    isNotNull(waiverRecords.integrityVersion),
    // A verdict dated after now is due too: a forged far-future time would
    // otherwise keep a row out of every pass.
    or(
      isNull(waiverRecords.integrityCheckedAt),
      lt(waiverRecords.integrityCheckedAt, options.now),
      gt(waiverRecords.integrityCheckedAt, options.now),
    ),
  );

  while (summary.checked < limit) {
    const rows = await db
      .select({
        record: WAIVER_SEALED_COLUMNS,
        // Read by `verifyWaiverIntegrity` on an erased (version 2) seal.
        draftShopAnswers: waiverRecords.draftShopAnswers,
        draftMedicalAlert: waiverRecords.draftMedicalAlert,
        previousVerdict: waiverRecords.integrityValid,
      })
      .from(waiverRecords)
      .where(due)
      // diveday:allow-time-id-order: a drain nobody is shown; the id only keeps a batch stable.
      .orderBy(
        // Future-dated verdicts first, so a cap cannot leave them for last.
        sql`coalesce(${waiverRecords.integrityCheckedAt} > ${options.now}, false) desc`,
        sql`${waiverRecords.integrityCheckedAt} asc nulls first`,
        waiverRecords.id,
      )
      .limit(Math.min(batchSize, limit - summary.checked));
    if (rows.length === 0) return summary;

    for (const row of rows) {
      const verdict = waiverIntegrityVerdict(
        {
          ...row.record,
          draftShopAnswers: row.draftShopAnswers,
          draftMedicalAlert: row.draftMedicalAlert,
        },
        options.now,
      );
      // Both columns are non-null on every row `due` selects, so the verdict is
      // too; a row that somehow read otherwise stops the pass rather than being
      // selected again forever.
      const { integrityHash, integrityVersion } = row.record;
      if (verdict.integrityValid === null || !integrityHash || !integrityVersion)
        throw new Error("recheckWaiverSeals: a due row read as unsealed");
      await db
        .update(waiverRecords)
        .set(verdict)
        .where(
          and(
            eq(waiverRecords.id, row.record.id),
            eq(waiverRecords.integrityHash, integrityHash),
            eq(waiverRecords.integrityVersion, integrityVersion),
          ),
        );
      summary.checked += 1;
      if (!verdict.integrityValid) {
        summary.invalid += 1;
        if (row.previousVerdict !== false) summary.newlyInvalid += 1;
      }
    }
    if (rows.length < batchSize) return summary;
  }

  const [more] = await db.select({ id: waiverRecords.id }).from(waiverRecords).where(due).limit(1);
  summary.capped = Boolean(more);
  return summary;
}
