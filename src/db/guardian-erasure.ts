import { and, eq, isNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  computeWaiverIntegrityHash,
  verifyWaiverIntegrity,
  WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
  WAIVER_INTEGRITY_VERSION_MOVED,
  WAIVER_INTEGRITY_VERSION_SIGNED,
} from "@/lib/waiver-integrity";
import { canPersonErasePersonalData } from "./authz";
import type { AppDb } from "./client";
import { type WaiverRecord, waiverRecords } from "./schema";

export type GuardianEmailErasure =
  | { ok: true; erased: number }
  | { ok: false; reason: "not_authorized" | "not_found" };

/** How the address is compared: as a mailbox, not as the bytes somebody typed. */
const normalized = (email: string) => email.trim().toLowerCase();

/**
 * **Erase a co-signing guardian's email address, and only that** (H-101,
 * issue #1673).
 *
 * A parent who co-signs a minor's release hands the shop an address. They are
 * not a diver, hold no booking and have no record of their own, so the diver's
 * erasure (`anonymizeDiver`) was the only way to remove it — destroying the
 * minor's medical answers and everything else on the child for a request the
 * parent made about themselves.
 *
 * **What it does.** Nulls `guardian_email` on every live release in this shop
 * carrying that address — the guardian of two children asked once — strips it
 * from a half-finished guardian draft as well, and stamps who did it and when.
 * The guardian's name, relationship, method and timestamps stay: they are who
 * signed and when, and the release is still the shop's evidence of that.
 *
 * **What the seal says afterwards.** `guardian_email` is inside the version 1
 * seal, so a release whose seal verified *before* the erasure is re-sealed as
 * version 4 — everything it sealed but the address, plus the redaction stamp —
 * and reads as valid and redacted, never as tampered. An unsealed release stays
 * unsealed, and one already failing its seal keeps failing: an erasure never
 * mints assurance a release did not have, nor launders an earlier edit — the
 * rule `anonymizeDiver` and `refileWaiverRecords` follow.
 *
 * **Who may.** The diver-erasure permission, re-read here as `anonymizeDiver`
 * re-reads it, because a server action is reachable without the page that
 * draws its form. And the address must be on a release of the diver the
 * staffer is looking at, in their own shop: a request names a guardian through
 * a child the shop knows, never an address typed into a box, and a shop can
 * never reach another shop's releases whatever it types.
 */
export async function eraseGuardianEmail(
  db: AppDb,
  input: { shopId: string; personId: string; email: string; actorPersonId: string; now?: Date },
): Promise<GuardianEmailErasure> {
  const email = normalized(input.email);
  if (!email) return { ok: false, reason: "not_found" };
  return db.transaction(async (tx) => {
    if (!(await canPersonErasePersonalData(tx, input.shopId, input.actorPersonId))) {
      return { ok: false, reason: "not_authorized" } as const;
    }
    const sameAddress = sql`lower(trim(${waiverRecords.guardianEmail})) = ${email}`;
    const [anchor] = await tx
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          eq(waiverRecords.personId, input.personId),
          sameAddress,
        ),
      )
      .limit(1);
    if (!anchor) return { ok: false, reason: "not_found" } as const;

    const now = input.now ?? nowDate();
    const records = await tx
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          sameAddress,
          isNull(waiverRecords.anonymizedAt),
        ),
      )
      .for("update");
    for (const record of records) {
      const resealable =
        (record.integrityVersion === WAIVER_INTEGRITY_VERSION_SIGNED ||
          record.integrityVersion === WAIVER_INTEGRITY_VERSION_MOVED ||
          record.integrityVersion === WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED) &&
        verifyWaiverIntegrity(record) === "valid";
      const redacted: WaiverRecord = {
        ...record,
        guardianEmail: null,
        draftGuardian: record.draftGuardian ? { ...record.draftGuardian, email: null } : null,
        guardianEmailErasedAt: now,
        guardianEmailErasedByPersonId: input.actorPersonId,
      };
      await tx
        .update(waiverRecords)
        .set({
          guardianEmail: null,
          draftGuardian: redacted.draftGuardian,
          guardianEmailErasedAt: now,
          guardianEmailErasedByPersonId: input.actorPersonId,
          ...(resealable
            ? {
                integrityHash: computeWaiverIntegrityHash(
                  redacted,
                  WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
                ),
                integrityVersion: WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
              }
            : {}),
        })
        .where(and(eq(waiverRecords.id, record.id), eq(waiverRecords.shopId, input.shopId)));
    }

    // A draft the guardian saved and never submitted holds the same address
    // with no signed column beside it — nothing sealed, so nothing to re-seal.
    await tx
      .update(waiverRecords)
      .set({
        draftGuardian: sql`jsonb_set(${waiverRecords.draftGuardian}, '{email}', 'null'::jsonb)`,
      })
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          sql`lower(trim(${waiverRecords.draftGuardian}->>'email')) = ${email}`,
        ),
      );
    return { ok: true, erased: records.length } as const;
  });
}

/**
 * The guardian addresses on one diver's releases, for the control that erases
 * them. Shop-scoped like every read of a diver; distinct by mailbox.
 */
export async function listGuardianEmails(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<string[]> {
  const rows = await db
    .select({ email: waiverRecords.guardianEmail })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        sql`${waiverRecords.guardianEmail} is not null`,
      ),
    );
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (row.email && !seen.has(normalized(row.email))) seen.set(normalized(row.email), row.email);
  }
  return [...seen.values()];
}
