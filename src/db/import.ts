/**
 * Applies a prepared contact import to one shop (ADR 20260723-contact-importer,
 * ADR 20260724-import-waiver-acceptance). The safety normalization already
 * happened in src/lib/import.ts — this layer only writes what that plan
 * allows, and never more:
 *   - cards insert `verified` and flagged imported (`importedAt`), awaiting a
 *     one-tap staff confirm — DiveDay trusts a card the shop's own system
 *     already checked (ADR 20260724-import-verified-cards);
 *   - specialty cards insert the same way, with the one difference that their
 *     *gate* holds until that confirm (ADR 20260725-import-specialty-cards) —
 *     the hold is in `specialtyBlocker`, not in the status written here;
 *   - people are matched by email so re-running an import updates rather than
 *     duplicates the roster;
 *   - a card number already on file is left alone, so an import never disturbs
 *     an existing (possibly already-confirmed) card;
 *   - a row claiming a prior waiver acceptance writes an immutable `completed`
 *     waiver record marked `imported`, snapshotting the shop's current
 *     template for reference only — never touched if the diver already has
 *     current signed/medical-review evidence on file.
 * Everything is scoped by the shopId the caller reads from the session, never a
 * URL, and the whole batch commits in one transaction (document fetches happen
 * once, beforehand, outside it) so a preview and its commit describe the same
 * roster.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { canImportShopData, type Role } from "@/lib/authz";
import { calendarDateToUtcMidnight } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { PreparedImport, PreparedRow } from "@/lib/import";
import { storeImportWaiverDocument } from "@/lib/storage";
import { ingestImageUrl } from "@/lib/storage/ingest-url";
import { createWaiverToken, hashWaiverToken, isCompletedWaiverCurrent } from "@/lib/waivers";
import { type AppDb, isUniqueConstraintViolation } from "./client";
import {
  certifications,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
  specialtyCertifications,
  userAccounts,
  waiverRecords,
} from "./schema";
import { getCurrentWaiverTemplate } from "./waivers";

export type ImportSummary = {
  peopleCreated: number;
  peopleUpdated: number;
  /** Rows that added cards/waiver to a diver an earlier row in the same file brought in. */
  rowsMerged: number;
  cardsAdded: number;
  cardsSkippedExisting: number;
  /** Specialty cards written, flagged imported (ADR 20260725-import-specialty-cards). */
  specialtyAdded: number;
  specialtySkippedExisting: number;
  /**
   * A card number on the file is already live in this shop on a **different**
   * diver, so the unique index forbids a second row and nothing was written for
   * this one. Reported apart from "already on file" because that phrasing would
   * tell an owner this diver is carded when they are not.
   */
  cardsHeldByAnotherDiver: number;
  nitroxAdded: number;
  nitroxSkippedExisting: number;
  /** Imported as a trusted, completed `imported` waiver record (ADR 20260724-import-waiver-acceptance). */
  waiversAdded: number;
  /** The diver already had a current signed/medical-review record on file, untouched. */
  waiversSkippedExisting: number;
  /** The shop has no waiver template configured, so there was nothing to snapshot against. */
  waiversSkippedNoTemplate: number;
  /** A waiver_document_url / medical_document_url did not fetch/store and was left off the record. */
  waiverDocumentsFailed: number;
  rowsSkipped: number;
};

/**
 * A batch import can carry up to MAX_IMPORT_ROWS (5,000) rows, each with up to
 * two document URLs — an unbounded `Promise.all` over every fetch at once
 * would open thousands of simultaneous outbound connections from one staff
 * submission. Capped low and fixed regardless of row count: this is
 * resource-exhaustion protection for the server, not a per-shop rate limit.
 */
const DOCUMENT_FETCH_CONCURRENCY = 6;

/** Runs `worker` over `items` with at most `concurrency` calls in flight at once. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

/**
 * Fetches each row's raw waiver_document_url / medical_document_url once,
 * server-side, and re-stores it in DiveDay's own image storage — the same
 * SSRF-safe pipeline a staff-pasted dive-site image goes through
 * (`src/lib/storage/ingest-url.ts`) — before anything is written. Network I/O
 * on purpose stays outside `commitContactImport`'s transaction; a failed or
 * unconfigured fetch drops that one document (counted, never fatal to the
 * row). Fetches run at a bounded concurrency (`DOCUMENT_FETCH_CONCURRENCY`),
 * never one `Promise.all` per document across the whole batch.
 */
async function resolveImportWaiverDocuments(
  rows: readonly PreparedRow[],
): Promise<{ rows: PreparedRow[]; documentsFailed: number }> {
  type DocField = "documentUrl" | "medicalDocumentUrl";
  const tasks: { rowIndex: number; field: DocField; url: string }[] = [];
  rows.forEach((row, rowIndex) => {
    if (!row.waiver) return;
    if (row.waiver.documentUrl) {
      tasks.push({ rowIndex, field: "documentUrl", url: row.waiver.documentUrl });
    }
    if (row.waiver.medicalDocumentUrl) {
      tasks.push({ rowIndex, field: "medicalDocumentUrl", url: row.waiver.medicalDocumentUrl });
    }
  });
  if (tasks.length === 0) return { rows: [...rows], documentsFailed: 0 };

  let documentsFailed = 0;
  const resolved = await mapWithConcurrency(tasks, DOCUMENT_FETCH_CONCURRENCY, async (task) => {
    const result = await ingestImageUrl(task.url, (upload) => storeImportWaiverDocument(upload));
    if (result.status === "stored" || result.status === "unchanged") return result.url;
    documentsFailed += 1;
    return null;
  });

  const patchesByRow = new Map<number, Partial<Record<DocField, string | null>>>();
  tasks.forEach((task, i) => {
    const patch = patchesByRow.get(task.rowIndex) ?? {};
    patch[task.field] = resolved[i];
    patchesByRow.set(task.rowIndex, patch);
  });

  const rowsOut = rows.map((row, rowIndex) => {
    const patch = patchesByRow.get(rowIndex);
    if (!patch || !row.waiver) return row;
    return { ...row, waiver: { ...row.waiver, ...patch } };
  });
  return { rows: rowsOut, documentsFailed };
}

const cardKey = (agency: string, identifier: string) => `${agency}:${identifier.toLowerCase()}`;
/** Mirrors the specialty table's unique index, which includes the specialty. */
const specialtyKey = (agency: string, specialty: string, identifier: string) =>
  `${agency}:${specialty}:${identifier.toLowerCase()}`;

function hasSize(row: PreparedRow): boolean {
  const { bcdSize, wetsuitSize, bootSize, finSize } = row.sizes;
  return Boolean(bcdSize || wetsuitSize || bootSize || finSize);
}

/**
 * Write the importable rows of a prepared plan. Returns a per-family tally the
 * UI reports verbatim — the honest record of what a click actually did.
 */
export async function commitContactImport(
  db: AppDb,
  shopId: string,
  prepared: PreparedImport,
  importedByPersonId: string,
): Promise<ImportSummary> {
  // `merge` rows are written too — they are the second and third cards of a
  // diver an earlier row brought in (ADR 20260725-import-specialty-cards).
  const preparedRows = prepared.rows.filter((row) => row.action !== "skip");
  const summary: ImportSummary = {
    peopleCreated: 0,
    peopleUpdated: 0,
    rowsMerged: 0,
    cardsAdded: 0,
    cardsSkippedExisting: 0,
    specialtyAdded: 0,
    specialtySkippedExisting: 0,
    cardsHeldByAnotherDiver: 0,
    nitroxAdded: 0,
    nitroxSkippedExisting: 0,
    waiversAdded: 0,
    waiversSkippedExisting: 0,
    waiversSkippedNoTemplate: 0,
    waiverDocumentsFailed: 0,
    rowsSkipped: prepared.rows.length - preparedRows.length,
  };
  if (preparedRows.length === 0) return summary;

  const { rows, documentsFailed } = await resolveImportWaiverDocuments(preparedRows);
  summary.waiverDocumentsFailed = documentsFailed;
  const now = nowDate();

  return db.transaction(async (tx) => {
    const template = rows.some((row) => row.waiver)
      ? await getCurrentWaiverTemplate(tx, shopId)
      : null;

    // Match existing divers by email so a re-import updates the roster instead
    // of minting a second person row (and orphaning the first's cards, waivers,
    // and fit). Emails were lower-cased and de-duplicated in prepare.
    const emails = [
      ...new Set(rows.map((row) => row.email).filter((v): v is string => Boolean(v))),
    ];
    const existingPeople = emails.length
      ? await tx
          .select({ id: people.id, email: people.email })
          .from(people)
          .where(
            and(eq(people.shopId, shopId), isNull(people.deletedAt), inArray(people.email, emails)),
          )
      : [];
    const personIdByEmail = new Map(
      existingPeople.flatMap((p) => (p.email ? [[p.email.toLowerCase(), p.id] as const] : [])),
    );

    // A card already on file is never touched: the import must not overwrite
    // evidence a staffer may have already verified. Each map is keyed exactly
    // like that family's unique index, and carries the `personId` that holds the
    // card — because "already on this diver" (a true no-op) and "that number is
    // live on a *different* diver in this shop" are different facts, and
    // reporting the second as the first tells an owner a diver is carded when
    // they are not (`security-reviewer` finding).
    const liveCerts = await tx
      .select({
        agency: certifications.agency,
        identifier: certifications.identifier,
        personId: certifications.personId,
      })
      .from(certifications)
      .where(and(eq(certifications.shopId, shopId), isNull(certifications.deletedAt)));
    const seenCerts = new Map(liveCerts.map((c) => [cardKey(c.agency, c.identifier), c.personId]));

    // Keyed on the specialty too, matching
    // specialty_certifications_shop_agency_specialty_identifier_unique: an agency
    // number identifies the diver, so one number legitimately carries a diver's
    // Deep *and* Wreck cards (ADR 20260725-import-specialty-cards).
    const liveSpecialty = await tx
      .select({
        agency: specialtyCertifications.agency,
        specialty: specialtyCertifications.specialty,
        identifier: specialtyCertifications.identifier,
        personId: specialtyCertifications.personId,
      })
      .from(specialtyCertifications)
      .where(
        and(eq(specialtyCertifications.shopId, shopId), isNull(specialtyCertifications.deletedAt)),
      );
    const seenSpecialty = new Map(
      liveSpecialty.map((c) => [specialtyKey(c.agency, c.specialty, c.identifier), c.personId]),
    );

    const liveNitrox = await tx
      .select({
        agency: nitroxCertifications.agency,
        identifier: nitroxCertifications.identifier,
        personId: nitroxCertifications.personId,
      })
      .from(nitroxCertifications)
      .where(and(eq(nitroxCertifications.shopId, shopId), isNull(nitroxCertifications.deletedAt)));
    const seenNitrox = new Map(
      liveNitrox.map((c) => [cardKey(c.agency, c.identifier), c.personId]),
    );

    for (const row of rows) {
      const emailKey = row.email?.toLowerCase();
      let personId = emailKey ? personIdByEmail.get(emailKey) : undefined;

      // A `merge` row is the same diver as an earlier row in this file (a
      // certification export lists one row per card). Its evidence is written
      // below against the person that row created; its contact fields are left
      // alone, and it is not counted as a person created or updated. If the
      // earlier row was itself skipped there is no person to attach to, so the
      // row is dropped rather than minting a second diver.
      if (row.action === "merge") {
        if (!personId) {
          summary.rowsSkipped += 1;
          continue;
        }
        summary.rowsMerged += 1;
        await writeEvidence(tx, {
          row,
          personId,
          shopId,
          now,
          summary,
          seenCerts,
          seenSpecialty,
          seenNitrox,
          template,
          importedByPersonId,
        });
        continue;
      }

      // Non-destructive update: identity name refreshes, contact fields only
      // fill in where the import actually carries a value.
      const applyUpdate = (id: string) =>
        tx
          .update(people)
          .set({
            fullName: row.fullName,
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
            ...(row.emergencyContactName ? { emergencyContactName: row.emergencyContactName } : {}),
            ...(row.emergencyContactPhone
              ? { emergencyContactPhone: row.emergencyContactPhone }
              : {}),
            ...(row.diveInsurance ? { diveInsurance: row.diveInsurance } : {}),
          })
          .where(and(eq(people.id, id), eq(people.shopId, shopId)));

      if (personId) {
        await applyUpdate(personId);
        summary.peopleUpdated += 1;
      } else {
        // A concurrent booking/wait-list/other import row can win the same
        // email between the batch lookup above and this insert
        // (people_shop_email_unique, CR-008) — fall back to updating the
        // winner's row instead of throwing, same as the branch above. The
        // insert runs in a nested transaction (savepoint): on real Postgres
        // a failed statement aborts the whole enclosing `tx` until an
        // explicit rollback, and a plain try/catch here would poison `tx`
        // for the reread below instead of converging on the winner
        // (see src/db/people.ts's findOrCreatePerson for the same pattern).
        try {
          const inserted = await tx.transaction(async (tx2) => {
            const [row2] = await tx2
              .insert(people)
              .values({
                shopId,
                fullName: row.fullName,
                email: row.email,
                phone: row.phone,
                dateOfBirth: row.dateOfBirth,
                emergencyContactName: row.emergencyContactName,
                emergencyContactPhone: row.emergencyContactPhone,
                diveInsurance: row.diveInsurance,
              })
              .returning({ id: people.id });
            if (!row2) throw new Error("commitContactImport: person insert returned no row");
            await tx2.insert(personRoles).values({ personId: row2.id, role: "diver" });
            return row2;
          });
          personId = inserted.id;
          summary.peopleCreated += 1;
        } catch (error) {
          if (!isUniqueConstraintViolation(error)) throw error;
          const [winner] = await tx
            .select({ id: people.id })
            .from(people)
            .where(
              and(
                eq(people.shopId, shopId),
                sql`lower(${people.email}) = lower(${row.email ?? ""})`,
                isNull(people.deletedAt),
              ),
            )
            .limit(1);
          if (!winner) throw error;
          personId = winner.id;
          await applyUpdate(personId);
          summary.peopleUpdated += 1;
        }
        if (emailKey) personIdByEmail.set(emailKey, personId);
      }

      await writeEvidence(tx, {
        row,
        personId,
        shopId,
        now,
        summary,
        seenCerts,
        seenSpecialty,
        seenNitrox,
        template,
        importedByPersonId,
      });
    }

    return summary;
  });
}

/**
 * Everything a row contributes to a diver who already exists: rental sizes,
 * cards, and a claimed waiver acceptance. Shared by the row that created the
 * diver and by every later `merge` row for the same diver — which is what lets a
 * one-row-per-card certification export bring in a diver's second and third
 * cards instead of discarding them as duplicate people.
 *
 * Each card insert is conflict-tolerant. The `seen*` maps close the common case
 * before the write, but a staffer entering a card by hand mid-import, or a
 * `lower()` that JS and Postgres read differently, would otherwise raise an
 * unhandled unique violation — and on real Postgres a failed statement aborts
 * the whole enclosing transaction, losing a 5,000-row migration to one row
 * (`security-reviewer` finding; `people` above takes the same care).
 */
async function writeEvidence(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  ctx: {
    row: PreparedRow;
    personId: string;
    shopId: string;
    now: Date;
    summary: ImportSummary;
    seenCerts: Map<string, string>;
    seenSpecialty: Map<string, string>;
    seenNitrox: Map<string, string>;
    template: Awaited<ReturnType<typeof getCurrentWaiverTemplate>> | null;
    importedByPersonId: string;
  },
): Promise<void> {
  const { row, personId, shopId, now, summary, template, importedByPersonId } = ctx;

  if (hasSize(row)) {
    // A living preference, upserted — never versioned. Only the sizes the
    // import actually carries are set, so importing a BCD size can't wipe a
    // wetsuit size already on file; an existing profile's rents-flags stay.
    const sizeSet = {
      ...(row.sizes.bcdSize ? { bcdSize: row.sizes.bcdSize } : {}),
      ...(row.sizes.wetsuitSize ? { wetsuitSize: row.sizes.wetsuitSize } : {}),
      ...(row.sizes.bootSize ? { bootSize: row.sizes.bootSize } : {}),
      ...(row.sizes.finSize ? { finSize: row.sizes.finSize } : {}),
    };
    await tx
      .insert(rentalFitProfiles)
      .values({ shopId, personId, ...sizeSet })
      .onConflictDoUpdate({
        target: [rentalFitProfiles.shopId, rentalFitProfiles.personId],
        set: sizeSet,
      });
  }

  /** Counts a card whose number is already live, honestly about *whose* it is. */
  const countSkipped = (holder: string, family: "card" | "specialty" | "nitrox") => {
    if (holder === personId) {
      if (family === "card") summary.cardsSkippedExisting += 1;
      else if (family === "specialty") summary.specialtySkippedExisting += 1;
      else summary.nitroxSkippedExisting += 1;
      return;
    }
    // A different diver in this shop holds that number. The card is not written
    // (the unique index forbids it), and calling that "already on file" would
    // tell the owner this diver is carded when they are not.
    summary.cardsHeldByAnotherDiver += 1;
  };

  if (row.cert) {
    const key = cardKey(row.cert.agency, row.cert.identifier);
    const holder = ctx.seenCerts.get(key);
    if (holder !== undefined) {
      countSkipped(holder, "card");
    } else {
      ctx.seenCerts.set(key, personId);
      // Imported cards land `verified` and flagged imported (`importedAt`),
      // with `reviewedAt` left null so the diver UI surfaces a one-tap staff
      // confirm (ADR 20260724-import-verified-cards). DiveDay trusts a card
      // the shop's own system already checked — unless the row itself says
      // otherwise, in which case `prepare` already downgraded it to `pending`.
      const inserted = await tx
        .insert(certifications)
        .values({
          shopId,
          personId,
          agency: row.cert.agency,
          level: row.cert.level,
          identifier: row.cert.identifier,
          expiresAt: row.cert.expiresAt,
          status: row.cert.status,
          // Flagged imported either way: provenance is a fact about where the
          // card came from, independent of whether we trusted it on arrival.
          importedAt: now,
          importedFromLabel: row.cert.sourceLabel,
        })
        .onConflictDoNothing()
        .returning({ id: certifications.id });
      if (inserted.length > 0) summary.cardsAdded += 1;
      else summary.cardsSkippedExisting += 1;
    }
  }

  for (const card of row.specialties) {
    const key = specialtyKey(card.agency, card.specialty, card.identifier);
    const holder = ctx.seenSpecialty.get(key);
    if (holder !== undefined) {
      countSkipped(holder, "specialty");
      continue;
    }
    ctx.seenSpecialty.set(key, personId);
    // Verified and flagged imported, like a level card — but the specialty gate
    // itself stays shut until a staffer taps confirm and stamps `reviewedAt`
    // (ADR 20260725-import-specialty-cards). That hold lives in
    // `specialtyBlocker` (src/lib/readiness.ts), which is where every specialty
    // requirement is evaluated; nothing here needs to weaken the status to
    // express it, and weakening it would lose the fact that the prior system did
    // check this card.
    const inserted = await tx
      .insert(specialtyCertifications)
      .values({
        shopId,
        personId,
        agency: card.agency,
        specialty: card.specialty,
        identifier: card.identifier,
        expiresAt: card.expiresAt,
        status: card.status,
        importedAt: now,
        importedFromLabel: card.sourceLabel,
      })
      .onConflictDoNothing()
      .returning({ id: specialtyCertifications.id });
    if (inserted.length > 0) summary.specialtyAdded += 1;
    else summary.specialtySkippedExisting += 1;
  }

  if (row.nitrox) {
    const key = cardKey(row.nitrox.agency, row.nitrox.identifier);
    const holder = ctx.seenNitrox.get(key);
    if (holder !== undefined) {
      countSkipped(holder, "nitrox");
    } else {
      ctx.seenNitrox.set(key, personId);
      // Verified and flagged imported, same posture as a level card. A
      // verified nitrox card authorizes enriched-air requests; the imported
      // marker keeps it distinguishable and fills are re-checked at fill time.
      const inserted = await tx
        .insert(nitroxCertifications)
        .values({
          shopId,
          personId,
          agency: row.nitrox.agency,
          identifier: row.nitrox.identifier,
          status: row.nitrox.status,
          importedAt: now,
          importedFromLabel: row.nitrox.sourceLabel,
        })
        .onConflictDoNothing()
        .returning({ id: nitroxCertifications.id });
      if (inserted.length > 0) summary.nitroxAdded += 1;
      else summary.nitroxSkippedExisting += 1;
    }
  }

  // Trusted acceptance (ADR 20260724-import-waiver-acceptance): only when
  // the row claimed one, the shop has a template to snapshot, and the
  // diver has no *current* evidence already — an import must never
  // disturb or duplicate evidence already on file, the same rule the
  // cert/nitrox blocks above follow. A live medical_review hold always
  // wins regardless of age: it is an unresolved referral block, and an
  // import must never be able to silently out-date it with a newer-dated
  // "clean" record (effectiveWaiverForBooking picks whichever of a hold
  // and a clean signature is more recent, so an import naively treated as
  // "already current" or freely insertable could otherwise clear a diver
  // who currently has a pending physician review). A *stale, expired*
  // completed record does not block the import — the diver already needs
  // a fresh signature per the shop's own currency rule, so a row with a
  // more current claim should fill that gap, not be silently dropped.
  if (row.waiver) {
    if (!template) {
      summary.waiversSkippedNoTemplate += 1;
    } else {
      const existingRecords = await tx
        .select()
        .from(waiverRecords)
        .where(
          and(
            eq(waiverRecords.shopId, shopId),
            eq(waiverRecords.personId, personId),
            inArray(waiverRecords.status, ["completed", "medical_review"]),
            isNull(waiverRecords.supersededAt),
          ),
        );
      const hasActiveHold = existingRecords.some((r) => r.status === "medical_review");
      const hasCurrentCompleted = existingRecords.some(
        (r) => r.status === "completed" && isCompletedWaiverCurrent(r, template.version, now),
      );
      if (hasActiveHold || hasCurrentCompleted) {
        summary.waiversSkippedExisting += 1;
      } else {
        const signedAt = row.waiver.signedAt ? calendarDateToUtcMidnight(row.waiver.signedAt) : now;
        await tx.insert(waiverRecords).values({
          shopId,
          bookingId: null,
          personId,
          templateId: template.id,
          templateTitle: template.title,
          templateVersion: template.version,
          templateBody: template.body,
          status: "completed",
          // No link is ever handed out for an imported record; a random
          // unusable hash keeps the unique token column satisfied without
          // granting bearer access (mirrors recordInPersonWaiver).
          tokenHash: hashWaiverToken(createWaiverToken()),
          expiresAt: now,
          signedName: row.fullName,
          signatureMethod: "imported",
          recordedByPersonId: importedByPersonId,
          consentedAt: signedAt,
          signedAt,
          medicalReviewRequired: false,
          completedAt: now,
          importedFromLabel: row.waiver.sourceLabel,
          importSourceDocumentUrl: row.waiver.documentUrl,
          importSourceMedicalDocumentUrl: row.waiver.medicalDocumentUrl,
        });
        summary.waiversAdded += 1;
      }
    }
  }
}

/**
 * Re-checks import privilege against the database, not the session's JWT —
 * roles are copied into the stateless token at sign-in and can be up to its
 * lifetime stale, so a demoted or disabled manager must lose the ability to
 * write the roster immediately, not at token expiry. Mirrors the export gate
 * (canPersonExportShopData). Requires a live person in this shop, an active
 * login, and a current owner/manager role.
 */
export async function canPersonImportShopData(
  db: AppDb,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [person] = await db
    .select({ id: people.id, deletedAt: people.deletedAt })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  if (!person || person.deletedAt) return false;

  const [account] = await db
    .select({ status: userAccounts.status })
    .from(userAccounts)
    .where(eq(userAccounts.personId, personId))
    .limit(1);
  if (account?.status !== "active") return false;

  const roleRows = await db
    .select({ role: personRoles.role })
    .from(personRoles)
    .where(eq(personRoles.personId, personId));
  return canImportShopData(roleRows.map((row) => row.role as Role));
}
