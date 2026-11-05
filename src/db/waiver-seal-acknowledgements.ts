import { and, eq, inArray } from "drizzle-orm";
import { integrityDigest, type WaiverSealedFields } from "@/lib/waiver-integrity";
import { canPersonManageWaiverTemplates } from "./authz";
import type { DbExecutor } from "./client";
import {
  MAX_WAIVER_SEAL_ACKNOWLEDGEMENT_NOTE,
  waiverRecords,
  waiverSealAcknowledgements,
} from "./schema";
import { WAIVER_SEALED_COLUMNS } from "./waiver-record-columns";

/**
 * **A broken waiver seal, acknowledged** (#3891): the table module for
 * `waiver_seal_acknowledgements`, appended and never edited.
 *
 * The nightly seal check (`recheckWaiverSeals`) stays red while any signed
 * release reads broken, on purpose (#3882): "already failing" is a column the
 * tamperer can write too. A manager who has looked into a broken release
 * records it here, with a note, and the check stops counting that release
 * while the acknowledgement still matches the release's current state.
 */

/**
 * The release as it stands, pinned: a keyed digest (the seal's own key,
 * `integrityDigest`) of every column any seal covers, the seal included. An
 * acknowledgement carries it, so a release edited again after someone looked
 * into it no longer matches and rings again. Keyed so the stored value is no
 * plain hash of a diver's medical answers.
 */
export function waiverSealStateDigest(record: WaiverSealedFields): string {
  const ordered = Object.keys(record)
    .sort()
    .map((key) => [key, record[key as keyof WaiverSealedFields] ?? null]);
  return integrityDigest(`waiver-seal-state\0${JSON.stringify(ordered)}`);
}

export type AcknowledgeBrokenWaiverSealResult =
  | { ok: true }
  | { ok: false; reason: "not_authorized" | "not_found" | "not_broken" | "note_required" };

/**
 * Record that `actorPersonId` looked into a broken release. Only someone who
 * may manage the shop's waivers, only on a release whose last checked verdict
 * is broken, and only with a note saying what they found. The digest is of
 * the release as it stands at this write.
 */
export async function acknowledgeBrokenWaiverSeal(
  db: DbExecutor,
  input: { shopId: string; recordId: string; actorPersonId: string; note: string; now: Date },
): Promise<AcknowledgeBrokenWaiverSealResult> {
  const note = input.note.trim();
  if (note.length === 0) return { ok: false, reason: "note_required" };
  if (note.length > MAX_WAIVER_SEAL_ACKNOWLEDGEMENT_NOTE) {
    return { ok: false, reason: "note_required" };
  }
  if (!(await canPersonManageWaiverTemplates(db, input.shopId, input.actorPersonId))) {
    return { ok: false, reason: "not_authorized" };
  }
  const [row] = await db
    .select({ record: WAIVER_SEALED_COLUMNS, valid: waiverRecords.integrityValid })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.id, input.recordId), eq(waiverRecords.shopId, input.shopId)))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.valid !== false) return { ok: false, reason: "not_broken" };
  await db.insert(waiverSealAcknowledgements).values({
    shopId: input.shopId,
    waiverRecordId: input.recordId,
    stateDigest: waiverSealStateDigest(row.record),
    note,
    acknowledgedByPersonId: input.actorPersonId,
    acknowledgedAt: input.now,
  });
  return { ok: true };
}

/**
 * Of these broken releases, the ids an acknowledgement still covers: one
 * whose state digest matches the release as read now. Read inside the
 * nightly pass's batch transaction.
 */
export async function acknowledgedWaiverSeals(
  db: DbExecutor,
  broken: readonly { record: WaiverSealedFields }[],
): Promise<Set<string>> {
  if (broken.length === 0) return new Set();
  const acks = await db
    .select({
      recordId: waiverSealAcknowledgements.waiverRecordId,
      shopId: waiverSealAcknowledgements.shopId,
      digest: waiverSealAcknowledgements.stateDigest,
    })
    .from(waiverSealAcknowledgements)
    .where(
      inArray(
        waiverSealAcknowledgements.waiverRecordId,
        broken.map((row) => row.record.id),
      ),
    );
  const covered = new Set<string>();
  for (const { record } of broken) {
    const digest = waiverSealStateDigest(record);
    if (
      acks.some(
        (ack) =>
          ack.recordId === record.id && ack.shopId === record.shopId && ack.digest === digest,
      )
    ) {
      covered.add(record.id);
    }
  }
  return covered;
}
