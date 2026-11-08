import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import { forgetClaudeCallContent } from "@/features/claude-call-content";
import { canPersonErasePersonalData } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { type WaiverRecord, waiverDrafts, waiverRecords } from "../../db/schema/index";
import { nowDate } from "../../lib/clock";
import {
  computeWaiverIntegrityHash,
  verifyWaiverIntegrity,
  WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
  WAIVER_INTEGRITY_VERSION_MOVED,
  WAIVER_INTEGRITY_VERSION_SIGNED,
  waiverIntegrityVerdict,
} from "../../lib/waiver-integrity";

export type GuardianEmailErasure =
  | { ok: true; erased: number }
  | { ok: false; reason: "not_authorized" | "not_found" };

/** How the address is compared: as a mailbox, not as the bytes somebody typed. */
const normalized = (email: string) => email.trim().toLowerCase();

/**
 * **Erase a co-signing guardian's email address, and only that** (H-20261007-guardian-email-erasure,
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
    // A draft is per door (issue #4130): any door's draft of the release counts.
    const sameDraftAddress = sql`lower(trim(${waiverDrafts.guardian}->>'email')) = ${email}`;
    const draftedHere = exists(
      tx
        .select({ id: waiverDrafts.id })
        .from(waiverDrafts)
        .where(
          and(
            eq(waiverDrafts.shopId, input.shopId),
            eq(waiverDrafts.waiverRecordId, waiverRecords.id),
            sameDraftAddress,
          ),
        ),
    );
    // The anchor is this diver's release in this shop, signed or still a
    // draft: a guardian who typed their address and never submitted handed it
    // over all the same (security review F1).
    const [anchor] = await tx
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, input.shopId),
          eq(waiverRecords.personId, input.personId),
          or(sameAddress, draftedHere),
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
        guardianEmailErasedAt: now,
        guardianEmailErasedByPersonId: input.actorPersonId,
      };
      const written: WaiverRecord = resealable
        ? {
            ...redacted,
            integrityHash: computeWaiverIntegrityHash(
              redacted,
              WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
            ),
            integrityVersion: WAIVER_INTEGRITY_VERSION_GUARDIAN_REDACTED,
          }
        : redacted;
      await tx
        .update(waiverRecords)
        .set({
          guardianEmail: null,
          guardianEmailErasedAt: now,
          guardianEmailErasedByPersonId: input.actorPersonId,
          integrityHash: written.integrityHash,
          integrityVersion: written.integrityVersion,
          // The row as written, re-checked: a seal that failed before the
          // redaction still fails, and says so in the cache (issue #2562).
          ...waiverIntegrityVerdict(written, now),
        })
        .where(and(eq(waiverRecords.id, record.id), eq(waiverRecords.shopId, input.shopId)));
    }

    // A draft the guardian saved and never submitted holds the same address
    // with no signed column beside it — nothing sealed, so nothing to re-seal.
    // Deliberately no erasure stamp either: the stamp forbids an address on
    // the row, and the guardian finishing that release later may give one.
    const drafts = await tx
      .update(waiverDrafts)
      .set({ guardian: sql`jsonb_set(${waiverDrafts.guardian}, '{email}', 'null'::jsonb)` })
      .where(and(eq(waiverDrafts.shopId, input.shopId), sameDraftAddress))
      .returning({ id: waiverDrafts.waiverRecordId });
    const touched = new Set([
      ...records.map((record) => record.id),
      ...drafts.map((row) => row.id),
    ]);
    // Every erasure forgets what the shop's Claude calls said: the text is
    // keyed to nobody, so no match can promise the guardian's words are not
    // in it (ADR 20261023-claude-call-content).
    await forgetClaudeCallContent(tx, { shopId: input.shopId, now });
    return { ok: true, erased: touched.size } as const;
  });
}

/**
 * The guardian addresses on one diver's releases, for the control that erases
 * them — the signed ones and any a guardian typed into a draft they never
 * submitted. Shop-scoped like every read of a diver; distinct by mailbox.
 */
export async function listGuardianEmails(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<string[]> {
  const signed = await db
    .select({ email: sql<string>`${waiverRecords.guardianEmail}` })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        sql`${waiverRecords.guardianEmail} is not null`,
      ),
    );
  // Every door's draft of this diver's releases (issue #4130).
  const drafted = await db
    .select({ email: sql<string>`${waiverDrafts.guardian}->>'email'` })
    .from(waiverDrafts)
    .innerJoin(
      waiverRecords,
      and(
        eq(waiverRecords.id, waiverDrafts.waiverRecordId),
        eq(waiverRecords.shopId, waiverDrafts.shopId),
      ),
    )
    .where(
      and(
        eq(waiverDrafts.shopId, shopId),
        eq(waiverRecords.personId, personId),
        sql`nullif(trim(${waiverDrafts.guardian}->>'email'), '') is not null`,
      ),
    );
  const rows = [...signed, ...drafted];
  const seen = new Map<string, string>();
  for (const { email } of rows) {
    // Both queries exclude null emails; signed rows may still contain whitespace.
    const key = normalized(email);
    if (key && !seen.has(key)) seen.set(key, email.trim());
  }
  return [...seen.values()];
}
