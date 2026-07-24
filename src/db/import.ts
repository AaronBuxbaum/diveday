/**
 * Applies a prepared contact import to one shop (ADR 20260723-contact-importer,
 * ADR 20260724-import-waiver-acceptance). The safety normalization already
 * happened in src/lib/import.ts — this layer only writes what that plan
 * allows, and never more:
 *   - cards insert at the schema default status `pending` (claimed); nothing
 *     here can set `verified`;
 *   - people are matched by email so re-running an import updates rather than
 *     duplicates the roster;
 *   - a card number already on file is left alone, so an import never disturbs
 *     an existing (possibly already-verified) card;
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
  userAccounts,
  waiverRecords,
} from "./schema";
import { getCurrentWaiverTemplate } from "./waivers";

export type ImportSummary = {
  peopleCreated: number;
  peopleUpdated: number;
  cardsAdded: number;
  cardsSkippedExisting: number;
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
  const preparedRows = prepared.rows.filter((row) => row.action === "import");
  const summary: ImportSummary = {
    peopleCreated: 0,
    peopleUpdated: 0,
    cardsAdded: 0,
    cardsSkippedExisting: 0,
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

    // A card number already on file (any agency) is never touched: the import
    // must not overwrite evidence a staffer may have already verified. Track
    // both live cards and cards added earlier in this same batch.
    const liveCerts = await tx
      .select({ agency: certifications.agency, identifier: certifications.identifier })
      .from(certifications)
      .where(and(eq(certifications.shopId, shopId), isNull(certifications.deletedAt)));
    const seenCerts = new Set(liveCerts.map((c) => cardKey(c.agency, c.identifier)));

    const liveNitrox = await tx
      .select({ agency: nitroxCertifications.agency, identifier: nitroxCertifications.identifier })
      .from(nitroxCertifications)
      .where(and(eq(nitroxCertifications.shopId, shopId), isNull(nitroxCertifications.deletedAt)));
    const seenNitrox = new Set(liveNitrox.map((c) => cardKey(c.agency, c.identifier)));

    for (const row of rows) {
      const emailKey = row.email?.toLowerCase();
      let personId = emailKey ? personIdByEmail.get(emailKey) : undefined;

      // Non-destructive update: identity name refreshes, contact fields only
      // fill in where the import actually carries a value.
      const applyUpdate = (id: string) =>
        tx
          .update(people)
          .set({
            fullName: row.fullName,
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.emergencyContactName ? { emergencyContactName: row.emergencyContactName } : {}),
            ...(row.emergencyContactPhone
              ? { emergencyContactPhone: row.emergencyContactPhone }
              : {}),
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
                emergencyContactName: row.emergencyContactName,
                emergencyContactPhone: row.emergencyContactPhone,
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

      if (row.cert) {
        const key = cardKey(row.cert.agency, row.cert.identifier);
        if (seenCerts.has(key)) {
          summary.cardsSkippedExisting += 1;
        } else {
          seenCerts.add(key);
          // No status set: the column defaults to `pending`. Claimed, by design.
          await tx.insert(certifications).values({
            shopId,
            personId,
            agency: row.cert.agency,
            level: row.cert.level,
            identifier: row.cert.identifier,
          });
          summary.cardsAdded += 1;
        }
      }

      if (row.nitrox) {
        const key = cardKey(row.nitrox.agency, row.nitrox.identifier);
        if (seenNitrox.has(key)) {
          summary.nitroxSkippedExisting += 1;
        } else {
          seenNitrox.add(key);
          await tx.insert(nitroxCertifications).values({
            shopId,
            personId,
            agency: row.nitrox.agency,
            identifier: row.nitrox.identifier,
          });
          summary.nitroxAdded += 1;
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
            const signedAt = row.waiver.signedAt
              ? calendarDateToUtcMidnight(row.waiver.signedAt)
              : now;
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

    return summary;
  });
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
