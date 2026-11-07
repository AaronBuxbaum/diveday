import { and, eq, inArray, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  computeWaiverIntegrityHash,
  signedIntegrityVersionFor,
  verifyWaiverIntegrity,
  WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
  WAIVER_INTEGRITY_VERSION_MOVED,
  WAIVER_INTEGRITY_VERSION_SIGNED,
  waiverIntegrityVerdict,
} from "@/lib/waiver-integrity";
import { importedSignaturesOverHold } from "@/lib/waivers";
import type { DbExecutor } from "./client";
import { waiverRecords } from "./schema";
import { listSignedWaiversByPerson } from "./waivers-audit";

/**
 * Refiles a diver's releases under another diver record, keeping every seal
 * that was honest an honest seal (issue #2080).
 *
 * `person_id` is inside the seal, so a bare repoint makes a valid release read
 * as tampered. Each release's seal is checked *before* the move: one whose
 * version 1 or version 3 seal verifies is re-sealed as version 3 over its new
 * owner, with who moved it, when and from which record inside the seal. An
 * unsealed release moves unsealed and one already failing its seal moves still
 * failing, so a move never launders an earlier edit. Erased releases are left
 * where they are: nothing personal is left on them, and their version 2 seal
 * covers the record they were erased under.
 *
 * An unsigned release with no seat that moves is set aside in the same
 * statement (issue #4020): signed, it would cover every seat the diver holds,
 * so the survivor must not end up with two of them, each with a live link.
 * `superseded_at` is outside the seal, and a set-aside release opens through
 * no link. A signed release, and an unsigned one on a seat, move as they are.
 *
 * Returns the ids it moved, read from the rows it locked.
 *
 * Called by `mergeDiverRecords` for every release of the record merged away,
 * which is also how a wrong split of a held seat is undone. A version 3
 * release verifies again after a second move, re-sealed over its newest owner.
 * A version 4 release — its guardian's address erased on request (H-20261007-guardian-email-erasure) —
 * moves under version 4 again: that seal covers the move fields too, and a
 * re-seal under version 3 would put the erased address back inside the seal.
 *
 * `movedFromPersonId` records only the latest hop: a release moved twice names
 * the record it last left, and the earlier hops survive only as the
 * merged-away records' own `merged_into_person_id` pointers.
 */
export async function refileWaiverRecords(
  tx: DbExecutor,
  input: {
    shopId: string;
    fromPersonId: string;
    toPersonId: string;
    actorPersonId: string;
    now?: Date;
  },
): Promise<string[]> {
  const now = input.now ?? nowDate();
  const records = await tx
    .select()
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.fromPersonId),
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    // Locked, as `eraseGuardianEmail` locks the same rows: a refile and a
    // guardian erasure racing would otherwise each re-seal from a row the
    // other had already rewritten (security review F3).
    .for("update");
  for (const record of records) {
    const resealable =
      (record.integrityVersion === WAIVER_INTEGRITY_VERSION_SIGNED ||
        record.integrityVersion === WAIVER_INTEGRITY_VERSION_MOVED ||
        record.integrityVersion === WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED) &&
      verifyWaiverIntegrity(record) === "valid";
    const moved = {
      ...record,
      personId: input.toPersonId,
      movedFromPersonId: record.personId,
      movedAt: now,
      movedByPersonId: input.actorPersonId,
    };
    const written = resealable
      ? {
          ...moved,
          integrityHash: computeWaiverIntegrityHash(moved, signedIntegrityVersionFor(moved)),
          integrityVersion: signedIntegrityVersionFor(moved),
        }
      : moved;
    await tx
      .update(waiverRecords)
      .set({
        personId: moved.personId,
        movedFromPersonId: moved.movedFromPersonId,
        movedAt: moved.movedAt,
        movedByPersonId: moved.movedByPersonId,
        ...(record.status === "pending" && record.bookingId === null && !record.supersededAt
          ? { supersededAt: now }
          : {}),
        integrityHash: written.integrityHash,
        integrityVersion: written.integrityVersion,
        // The row as written, re-checked: a refile never launders a failed
        // seal, and the cache says so (issue #2562).
        ...waiverIntegrityVerdict(written, now),
      })
      .where(and(eq(waiverRecords.id, record.id), eq(waiverRecords.shopId, input.shopId)));
  }
  return records.map((record) => record.id);
}

/**
 * **Keeps a medical hold governing after a merge** (issue #3815): sets aside
 * every imported release on the kept record that is newer than an uncleared
 * referral, where the merge moved either of the two. Reads the evidence the
 * seats read (`listSignedWaiversByPerson`), so "a referral on their own seat or
 * on no seat, superseded or not" means here what it means on the roster.
 *
 * Only `superseded_at` changes, which is outside the integrity seal: the
 * release stays on the record, no longer standing. Returns the records it set
 * aside, so the caller can say so on the diver's trail.
 */
export async function setAsideImportedOverHold(
  tx: DbExecutor,
  input: { shopId: string; personId: string; movedRecordIds: ReadonlySet<string>; now: Date },
): Promise<string[]> {
  // Without the seat-ownership filter: a retired refusal given on a seat the
  // merge left behind on the merged-away record is still this diver's hold.
  const evidence = (
    await listSignedWaiversByPerson(tx, input.shopId, [input.personId], { anySeat: true })
  ).get(input.personId);
  const setAside = importedSignaturesOverHold(evidence ?? [], input.movedRecordIds).map(
    (record) => record.id,
  );
  if (setAside.length === 0) return [];
  await tx
    .update(waiverRecords)
    .set({ supersededAt: input.now })
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        eq(waiverRecords.personId, input.personId),
        inArray(waiverRecords.id, setAside),
        isNull(waiverRecords.supersededAt),
      ),
    );
  return setAside;
}
