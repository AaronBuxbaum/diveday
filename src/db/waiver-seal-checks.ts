import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { log } from "@/lib/log";
import { waiverIntegrityVerdict } from "@/lib/waiver-integrity";
import type { DbExecutor } from "./client";
import { shops, waiverRecords } from "./schema";
import { WAIVER_SEALED_COLUMNS } from "./waiver-record-columns";

/** Rows read and re-checked per statement. */
export const WAIVER_SEAL_CHECK_BATCH = 200;
/** Rows one nightly pass re-checks at most; the rest wait for the next night, oldest first. */
export const WAIVER_SEAL_CHECK_LIMIT = 4_000;

/**
 * From when DiveDay sealed every release it took a signature for: the
 * migration that brought `integrity_hash` into the schema
 * (`20260721131359_cheerful_masque`, the baseline the history starts from).
 * Every signing path seals as it writes (`completeWaiver`,
 * `recordInPersonWaiver`), so a signed, non-imported release signed after both
 * this and its shop's own start that carries no seal has had it removed. The
 * baseline is the latest the column could have arrived, so it errs towards
 * calling an old row legacy rather than broken.
 */
export const WAIVER_SEALING_SHIPPED_AT = new Date("2026-07-21T13:13:59.000Z");

export type WaiverSealCheckSummary = {
  /** Sealed releases whose verdict this pass re-wrote. */
  checked: number;
  /** Of those, how many failed verification, or had their seal removed. */
  invalid: number;
  /** Of those, how many passed (or had never been checked) the last time: a seal that broke since. */
  newlyInvalid: number;
  /** True when the pass stopped at its limit with sealed releases still unchecked tonight. */
  capped: boolean;
};

/**
 * Whether a pass checks in healthy: no release it checked is broken. Every
 * broken one counts, not only one that broke since the last check, because
 * "already failing" is read from a column the tamperer can write too. A
 * release stays an alarm every night until someone deals with it. A pass that
 * stopped at its limit is not one on its own; the next night starts with the
 * rows checked longest ago, so every row comes round.
 */
export function waiverSealPassHealthy(summary: WaiverSealCheckSummary): boolean {
  return summary.invalid === 0;
}

/**
 * **The nightly re-check of every signed release's seal** (issue #2562),
 * across every shop: recomputes `verifyWaiverIntegrity` and re-writes the
 * cached verdict (`integrity_valid`, `integrity_checked_at`) that the signature
 * log's "Unsealed or changed" view filters on. A seal is written with a verdict
 * (`waiverIntegrityVerdict`), so this pass exists for the edit nobody made
 * through DiveDay: a row changed straight in the database reads `invalid` on
 * every page that shows it at once, and lands in the view by the next pass.
 *
 * A sealed row (a hash and a seal version) is verified. A row missing either
 * is checked too when its seal has been **removed** rather than broken: it
 * carries a verdict, which only a seal is written with, or it is a signed,
 * non-imported release signed after DiveDay sealed every signature
 * ({@link WAIVER_SEALING_SHIPPED_AT}) and after its shop began. Such a row is
 * written `invalid`. Any other unsealed row is legacy, which the view finds
 * by its nulls. Oldest verdict first (never-checked before all; one dated
 * after now ahead of those, since a forged future time would otherwise never
 * come due), and only rows checked at a time other than `now`, so a row is
 * read once per pass and a large log is covered over several nights rather
 * than in one run past the function's time limit.
 *
 * Each batch is read `FOR UPDATE` and written in one transaction, so an edit
 * cannot land between the read and the verdict about it; a re-seal (a merge's
 * refile, an erasure) waits for the batch and then writes its own verdict.
 * Each broken release is logged by its shop's id and its own, and nothing
 * else: never a diver's name or a medical answer leaves it.
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
  const unsealed = or(isNull(waiverRecords.integrityHash), isNull(waiverRecords.integrityVersion));
  const shopStartedAt = db
    .select({ at: shops.createdAt })
    .from(shops)
    .where(eq(shops.id, waiverRecords.shopId));
  const sealRemoved = and(
    unsealed,
    or(
      isNotNull(waiverRecords.integrityValid),
      and(
        inArray(waiverRecords.status, ["completed", "medical_review"]),
        or(isNull(waiverRecords.signatureMethod), ne(waiverRecords.signatureMethod, "imported")),
        sql`${waiverRecords.signedAt} >= greatest(${WAIVER_SEALING_SHIPPED_AT}::timestamptz, (${shopStartedAt}))`,
      ),
    ),
  );
  const due = and(
    or(
      and(isNotNull(waiverRecords.integrityHash), isNotNull(waiverRecords.integrityVersion)),
      sealRemoved,
    ),
    or(
      isNull(waiverRecords.integrityCheckedAt),
      lt(waiverRecords.integrityCheckedAt, options.now),
      gt(waiverRecords.integrityCheckedAt, options.now),
    ),
  );

  while (summary.checked < limit) {
    const take = Math.min(batchSize, limit - summary.checked);
    const read = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          record: WAIVER_SEALED_COLUMNS,
          shopId: waiverRecords.shopId,
          // Read by `verifyWaiverIntegrity` on an erased (version 2) seal.
          draftShopAnswers: waiverRecords.draftShopAnswers,
          draftMedicalAlert: waiverRecords.draftMedicalAlert,
          previousVerdict: waiverRecords.integrityValid,
        })
        .from(waiverRecords)
        .where(due)
        // diveday:allow-time-id-order: a drain nobody is shown; the id only keeps a batch stable.
        .orderBy(
          sql`coalesce(${waiverRecords.integrityCheckedAt} > ${options.now}, false) desc`,
          sql`${waiverRecords.integrityCheckedAt} asc nulls first`,
          waiverRecords.id,
        )
        .limit(take)
        .for("update");

      for (const row of rows) {
        const { integrityHash, integrityVersion } = row.record;
        const sealed = Boolean(integrityHash && integrityVersion);
        const verdict = sealed
          ? waiverIntegrityVerdict(
              {
                ...row.record,
                draftShopAnswers: row.draftShopAnswers,
                draftMedicalAlert: row.draftMedicalAlert,
              },
              options.now,
            )
          : { integrityValid: false, integrityCheckedAt: options.now };
        // A sealed row always verifies to a verdict; one that somehow read
        // otherwise stops the pass rather than being selected again forever.
        if (verdict.integrityValid === null)
          throw new Error("recheckWaiverSeals: a due row read as unsealed");
        await tx.update(waiverRecords).set(verdict).where(eq(waiverRecords.id, row.record.id));
        summary.checked += 1;
        if (!verdict.integrityValid) {
          summary.invalid += 1;
          const newly = row.previousVerdict !== false;
          if (newly) summary.newlyInvalid += 1;
          log("cron_waiver_seals.seal_invalid", "error", {
            shopId: row.shopId,
            recordId: row.record.id,
            sealRemoved: !sealed,
            newly,
          });
        }
      }
      return rows.length;
    });
    if (read < take) return summary;
  }

  const [more] = await db.select({ id: waiverRecords.id }).from(waiverRecords).where(due).limit(1);
  summary.capped = Boolean(more);
  return summary;
}

/**
 * **The people whose signed evidence is compromised** (issue #3885, attacker
 * review B1): anyone with a release at this shop whose seal failed its last
 * check, whatever that release's status now and whether or not it is the one
 * a seat would read. A tampered referral flipped back to pending, or
 * backdated behind a clean signature, stops being the effective release but
 * stays a changed record, so readiness holds the person on it.
 *
 * Only a clean release **signed after** the failed check clears it: the
 * desk's way out is to send the waiver and have the diver sign again. An
 * older clean signature never does, so backdating cannot reach it.
 */
export async function peopleWithFailedSeal(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Set<string>> {
  if (personIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.personId, [...personIds]),
        eq(waiverRecords.integrityValid, false),
        sql`not exists (select 1 from ${waiverRecords} as clean
          where clean.shop_id = ${waiverRecords.shopId}
          and clean.person_id = ${waiverRecords.personId}
          and clean.integrity_valid = true
          and clean.signed_at > ${waiverRecords.integrityCheckedAt})`,
      ),
    );
  return new Set(rows.flatMap((row) => (row.personId ? [row.personId] : [])));
}
