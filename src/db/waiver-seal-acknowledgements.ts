import { and, eq, inArray } from "drizzle-orm";
import {
  integrityDigest,
  verifyIntegrityDigest,
  type WaiverSealedFields,
} from "@/lib/waiver-integrity";
import { canPersonManageWaiverTemplates } from "./authz";
import type { DbExecutor } from "./client";
import { recordDiverActivity } from "./operations";
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
function waiverSealState(record: WaiverSealedFields): string {
  const ordered = Object.keys(record)
    .sort()
    .map((key) => [key, record[key as keyof WaiverSealedFields] ?? null]);
  return `waiver-seal-state\0${JSON.stringify(ordered)}`;
}

export function waiverSealStateDigest(record: WaiverSealedFields): string {
  return integrityDigest(waiverSealState(record));
}

export type AcknowledgeBrokenWaiverSealResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_authorized" | "not_found" | "not_broken" | "note_required" | "changed";
    };

/**
 * Record that `actorPersonId` looked into a broken release. Only someone who
 * may manage the shop's waivers, only on a release whose last checked verdict
 * is broken, and only with a note saying what they found.
 *
 * `expectedStateDigest` is the {@link waiverSealStateDigest} of the release as
 * the page showed it to the manager (layer-2 review S3). The row is locked and
 * re-digested here; if it changed between what they read and this write, the
 * acknowledgement is refused, so a second edit slipped in while they looked
 * is never covered by a review of the first.
 *
 * The same transaction writes a safety line on the diver's trail (review S4):
 * one manager cannot quieten the alarm without the shop's trail saying who.
 */
export async function acknowledgeBrokenWaiverSeal(
  db: DbExecutor,
  input: {
    shopId: string;
    recordId: string;
    actorPersonId: string;
    note: string;
    expectedStateDigest: string;
    now: Date;
  },
): Promise<AcknowledgeBrokenWaiverSealResult> {
  const note = input.note.trim();
  if (note.length === 0) return { ok: false, reason: "note_required" };
  if (note.length > MAX_WAIVER_SEAL_ACKNOWLEDGEMENT_NOTE) {
    return { ok: false, reason: "note_required" };
  }
  return db.transaction(async (tx): Promise<AcknowledgeBrokenWaiverSealResult> => {
    if (!(await canPersonManageWaiverTemplates(tx, input.shopId, input.actorPersonId))) {
      return { ok: false, reason: "not_authorized" };
    }
    const [row] = await tx
      .select({ record: WAIVER_SEALED_COLUMNS, valid: waiverRecords.integrityValid })
      .from(waiverRecords)
      .where(and(eq(waiverRecords.id, input.recordId), eq(waiverRecords.shopId, input.shopId)))
      // diveday:allow-update-lock: the digest is read and pinned in one step; an edit between the manager's view and this write must refuse, not slip under the acknowledgement.
      .for("update")
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.valid !== false) return { ok: false, reason: "not_broken" };
    const stateDigest = waiverSealStateDigest(row.record);
    if (!verifyIntegrityDigest(waiverSealState(row.record), input.expectedStateDigest))
      return { ok: false, reason: "changed" };
    await tx.insert(waiverSealAcknowledgements).values({
      shopId: input.shopId,
      waiverRecordId: input.recordId,
      stateDigest,
      note,
      acknowledgedByPersonId: input.actorPersonId,
      acknowledgedAt: input.now,
    });
    const recorded = await recordDiverActivity(tx, {
      shopId: input.shopId,
      personId: row.record.personId,
      actorPersonId: input.actorPersonId,
      code: "waiver_seal_acknowledged",
      waiverRecordId: input.recordId,
    });
    // No trail line, no acknowledgement: the quiet alarm must always say who.
    if (!recorded) throw new Error("acknowledgeBrokenWaiverSeal: the trail line was not written");
    return { ok: true };
  });
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
    const state = waiverSealState(record);
    if (
      acks.some(
        (ack) =>
          ack.recordId === record.id &&
          ack.shopId === record.shopId &&
          verifyIntegrityDigest(state, ack.digest),
      )
    ) {
      covered.add(record.id);
    }
  }
  return covered;
}
