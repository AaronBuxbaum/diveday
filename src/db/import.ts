/**
 * Applies a prepared contact import to one shop (ADR 20260723-contact-importer).
 * The safety normalization already happened in src/lib/import.ts — this layer
 * only writes what that plan allows, and never more:
 *   - cards insert at the schema default status `pending` (claimed); nothing
 *     here can set `verified`;
 *   - people are matched by email so re-running an import updates rather than
 *     duplicates the roster;
 *   - a card number already on file is left alone, so an import never disturbs
 *     an existing (possibly already-verified) card.
 * Everything is scoped by the shopId the caller reads from the session, never a
 * URL, and the whole batch commits in one transaction so a preview and its
 * commit describe the same roster.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { canImportShopData, type Role } from "@/lib/authz";
import type { PreparedImport, PreparedRow } from "@/lib/import";
import { type AppDb, isUniqueConstraintViolation } from "./client";
import {
  certifications,
  nitroxCertifications,
  people,
  personRoles,
  rentalFitProfiles,
  userAccounts,
} from "./schema";

export type ImportSummary = {
  peopleCreated: number;
  peopleUpdated: number;
  cardsAdded: number;
  cardsSkippedExisting: number;
  nitroxAdded: number;
  nitroxSkippedExisting: number;
  rowsSkipped: number;
};

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
): Promise<ImportSummary> {
  const rows = prepared.rows.filter((row) => row.action === "import");
  const summary: ImportSummary = {
    peopleCreated: 0,
    peopleUpdated: 0,
    cardsAdded: 0,
    cardsSkippedExisting: 0,
    nitroxAdded: 0,
    nitroxSkippedExisting: 0,
    rowsSkipped: prepared.rows.length - rows.length,
  };
  if (rows.length === 0) return summary;

  return db.transaction(async (tx) => {
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
