import { and, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  computeWaiverIntegrityHash,
  signedIntegrityVersionFor,
  verifyWaiverIntegrity,
  WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
  WAIVER_INTEGRITY_VERSION_MOVED,
  WAIVER_INTEGRITY_VERSION_SIGNED,
} from "@/lib/waiver-integrity";
import type { DbExecutor } from "./client";
import { waiverRecords } from "./schema";

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
 * Called by `mergeDiverRecords` for every release of the record merged away,
 * which is also how a wrong split of a held seat is undone. A version 3
 * release verifies again after a second move, re-sealed over its newest owner.
 * A version 4 release — its guardian's address erased on request (H-101) —
 * moves under version 4 again: that seal covers the move fields too, and a
 * re-seal under version 3 would put the erased address back inside the seal.
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
): Promise<void> {
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
    );
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
    await tx
      .update(waiverRecords)
      .set({
        personId: moved.personId,
        movedFromPersonId: moved.movedFromPersonId,
        movedAt: moved.movedAt,
        movedByPersonId: moved.movedByPersonId,
        ...(resealable
          ? {
              integrityHash: computeWaiverIntegrityHash(moved, signedIntegrityVersionFor(moved)),
              integrityVersion: signedIntegrityVersionFor(moved),
            }
          : {}),
      })
      .where(and(eq(waiverRecords.id, record.id), eq(waiverRecords.shopId, input.shopId)));
  }
}
