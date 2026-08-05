import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nowMs } from "@/lib/clock";
import {
  computeWaiverIntegrityHash,
  WAIVER_INTEGRITY_VERSION_SIGNED,
} from "@/lib/waiver-integrity";
import type { DbExecutor } from "./client";
import { type WaiverRecord, waiverRecords } from "./schema";
import { at } from "./seed-clock";

/**
 * What the shop's signed evidence actually looks like — the Signatures tab's
 * data (`/shop/[shopSlug]/waivers/signatures`).
 *
 * Two things were wrong with the evidence the other scenarios leave behind, and
 * both of them taught the reader something false:
 *
 *  1. **Everything was signed at the same instant.** Every upcoming booking's
 *     release carried `signedAt = now`, because the scenario that writes it
 *     stamps the row as it inserts it. The audit trail is ordered by signature,
 *     so its whole first page read as one timestamp — a shop where a hundred
 *     and sixty people signed in the same second. Divers sign when they book,
 *     which is days or weeks before they dive.
 *  2. **Nothing was sealed.** `completeWaiver` and `recordInPersonWaiver` both
 *     seal a record the moment they write it (an HMAC over the immutable signed
 *     metadata — src/lib/waiver-integrity.ts), so a live shop's recent evidence
 *     verifies. A seeded record never went through either, so *every* row read
 *     "Not sealed" and the integrity column had exactly one value.
 *
 * This scenario fixes both, and the fix is itself the story a demo should tell:
 * releases signed since the shop's account got the evidence seal carry a
 * verifiable seal; everything signed before it is the unsealed legacy the
 * migration brought across. The cutoff sits close enough to today that the
 * audit trail's first page shows both.
 *
 * **Runs last in `seedDemoSchedule`, and only ever updates.** It inserts
 * nothing and deletes nothing, so no row seeded before it moves and no
 * `nextCreatedAt()` stamp shifts — the same adds-only discipline
 * `seedCertGates` and `seedBuddyPairs` follow. It has to run last for a
 * different reason too: a seal covers the record's *final* stored metadata, so
 * anything that still had a waiver row to write must already have written it.
 *
 * Readiness is deliberately untouched. Sealing is orthogonal to it, and the
 * re-dated signatures stay inside `WAIVER_SIGNATURE_VALIDITY_MS` and keep their
 * template version, so `isCompletedWaiverCurrent` answers exactly what it
 * answered before for every booking on the board.
 */

/**
 * The instant the demo shop's account got the evidence seal. Records signed at
 * or after it are sealed; everything older is unsealed legacy.
 *
 * Yesterday morning, and the recency is the whole reason for the number. The
 * audit trail pages twenty rows at a time ordered by signature, and the spread
 * below lays roughly eight signatures on each of the last three weeks' days —
 * so page one covers about two and a half days. A cutoff further back would
 * make every row on the first page sealed and bury the legacy state nine pages
 * down; this one puts both states on the screen a reader actually opens. It
 * also means "sealed" is a modest slice of the shop's evidence rather than most
 * of it, which is exactly what a shop that has just been switched on looks like.
 */
const SEAL_ENABLED_AT = () => at(-1, 9);

/**
 * How many days back the same-instant signatures get spread over. Three weeks:
 * long enough that the day-by-day rhythm is visible, short enough that every
 * re-dated signature is still comfortably current.
 */
const SIGNING_SPREAD_DAYS = 21;

/**
 * When signature number `index` was really signed.
 *
 * Deterministic in the index alone — never a random draw and never a live clock
 * read — so the frozen-clock e2e fleet renders an identical audit trail on
 * every run. Day 0 is measured back from `nowMs()` rather than pinned to a wall
 * hour, because "today at 8am" is in the future for anyone who opens the demo
 * before breakfast; a fixed number of minutes ago is in the past whenever it is
 * read. The per-index millisecond keeps two signatures on the same day from
 * tying, which is what `nextCreatedAt` exists to prevent elsewhere.
 */
function signedAtFor(index: number): Date {
  const daysBack = index % SIGNING_SPREAD_DAYS;
  if (daysBack === 0) return new Date(nowMs() - (35 + index * 7) * 60_000);
  const hour = 8 + (index % 8);
  const minute = (index * 13) % 60;
  return new Date(at(-daysBack, hour, minute).getTime() + (index % 1_000));
}

export async function seedWaiverEvidence(db: DbExecutor, shopId: string): Promise<void> {
  // Ordered so the spread below is a pure function of the seed, not of whatever
  // order the heap hands rows back in. `createdAt` is unique per row by
  // construction (`nextCreatedAt`), and the id breaks any tie a scenario that
  // stamps its own dates might still leave.
  const records = await db
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.status, ["completed", "medical_review"]),
      ),
    )
    .orderBy(asc(waiverRecords.createdAt), asc(waiverRecords.id));
  if (records.length === 0) return;

  // Only the ones stamped at the seed's own "now" get re-dated. The history
  // back-fill already signs its releases on the day its trips sailed, and a
  // scenario that took the trouble to date a signature is not something this
  // one should overwrite.
  const todayStart = at(0, 0).getTime();
  const sealFrom = SEAL_ENABLED_AT().getTime();

  let spreadIndex = 0;
  const updates: { id: string; next: WaiverRecord }[] = [];
  for (const record of records) {
    const stampedNow = (record.signedAt?.getTime() ?? 0) >= todayStart;
    const signedAt = stampedNow ? signedAtFor(spreadIndex) : record.signedAt;
    if (stampedNow) spreadIndex += 1;
    const sealed = (signedAt?.getTime() ?? 0) >= sealFrom;
    if (!stampedNow && !sealed) continue;
    // The seal covers the record exactly as it will be stored, so the metadata
    // is built from the row *after* the re-date, never before it — a seal over
    // the old timestamps would verify as `invalid`, which is the one thing a
    // demo of an integrity check must never show for untampered evidence.
    const next: WaiverRecord = {
      ...record,
      signedAt,
      // A release is consented to and completed in the same sitting it is
      // signed in; the seeded rows already tie all three together, so they move
      // together too.
      consentedAt: stampedNow ? signedAt : record.consentedAt,
      completedAt: stampedNow ? signedAt : record.completedAt,
      createdAt: stampedNow && signedAt ? signedAt : record.createdAt,
      integrityHash: null,
      integrityVersion: null,
    };
    const hash = sealed ? computeWaiverIntegrityHash(next, WAIVER_INTEGRITY_VERSION_SIGNED) : null;
    updates.push({
      id: record.id,
      next: {
        ...next,
        integrityHash: hash,
        integrityVersion: hash ? WAIVER_INTEGRITY_VERSION_SIGNED : null,
      },
    });
  }

  await applyEvidence(db, updates);

  // Pending links are deliberately left alone. They are not evidence, they are
  // never sealed, and their `createdAt`/`expiresAt` pair is what keeps the
  // "click Send waiver" flows live — back-dating a request would age out the
  // very links the staff UI and e2e both need issuable.
}

/**
 * How many rows one `UPDATE … FROM (VALUES …)` carries. Seven bound parameters
 * per row, so this is nowhere near Postgres's 65535-parameter ceiling; it is
 * sized to keep one statement's plan small rather than to dodge a limit.
 */
const EVIDENCE_UPDATE_CHUNK = 250;

/**
 * Write the re-dated, sealed rows back — **in chunks, not one statement each.**
 *
 * The obvious loop (`db.update(...).where(eq(id))` per record) is what this
 * replaces, and the reason is the e2e fleet rather than elegance: this pass
 * touches every signature stamped at the seed's own "now", which on the demo
 * shop is a hundred and sixty of them, and `/api/test/reset` re-runs the whole
 * seed before *every* browser test. Measured, the per-row loop cost ~850ms a
 * pass — comparable to the entire rest of the reset (~1.2s), and paid a hundred
 * and fifty times over in a local suite. A handful of set-based statements do
 * the same work in a fraction of it.
 *
 * Every column is cast explicitly in the VALUES list: Postgres infers a VALUES
 * column's type from its first row, and both the timestamps and the integrity
 * columns are legitimately null on some rows — an untyped null first row would
 * make the column `text` and the join fail.
 */
async function applyEvidence(
  db: DbExecutor,
  updates: { id: string; next: WaiverRecord }[],
): Promise<void> {
  for (let start = 0; start < updates.length; start += EVIDENCE_UPDATE_CHUNK) {
    const chunk = updates.slice(start, start + EVIDENCE_UPDATE_CHUNK);
    const rows = sql.join(
      chunk.map(
        ({ id, next }) =>
          sql`(${id}::uuid, ${next.signedAt}::timestamptz, ${next.consentedAt}::timestamptz, ${next.completedAt}::timestamptz, ${next.createdAt}::timestamptz, ${next.integrityHash}::text, ${next.integrityVersion}::integer)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      update ${waiverRecords} as target set
        signed_at = source.signed_at,
        consented_at = source.consented_at,
        completed_at = source.completed_at,
        created_at = source.created_at,
        integrity_hash = source.integrity_hash,
        integrity_version = source.integrity_version
      from (values ${rows}) as source (
        id, signed_at, consented_at, completed_at, created_at, integrity_hash, integrity_version
      )
      where target.id = source.id
    `);
  }
}
