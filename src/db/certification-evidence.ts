import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TripAdmissionEvidence } from "@/lib/trip-admission";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { certifications, nitroxCertifications, specialtyCertifications } from "./schema";

/**
 * **One diver's live cert evidence at this shop** — the same rows readiness
 * reads, and the only thing `decideTripAdmission` is ever handed.
 *
 * It lived inside `src/db/bookings.ts` as a private helper while the booking
 * transaction was its one caller. `src/db/next-dive.ts` is the second: the
 * recap's next-dive card drops every candidate departure admission refuses, so
 * it needs the identical three reads over the identical `deleted_at` filters.
 * Two copies of "what this shop knows about this diver's cards" is exactly the
 * kind of pair that drifts silently and lets one surface admit what another
 * refuses, so the function moved here rather than being written twice.
 *
 * A `DbExecutor` rather than an `AppDb`, unchanged: the booking path calls it
 * inside its own transaction, and `queryAll` is what keeps a fan-out on a
 * pinned client queued rather than parallel (src/db/client.ts).
 */
export async function readCertificationEvidence(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<TripAdmissionEvidence> {
  const [certificationRows, specialtyRows, nitroxRows] = await queryAll(tx, [
    () =>
      tx
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, shopId),
            eq(certifications.personId, personId),
            isNull(certifications.deletedAt),
          ),
        ),
    () =>
      tx
        .select()
        .from(specialtyCertifications)
        .where(
          and(
            eq(specialtyCertifications.shopId, shopId),
            eq(specialtyCertifications.personId, personId),
            isNull(specialtyCertifications.deletedAt),
          ),
        ),
    () =>
      tx
        .select()
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, shopId),
            eq(nitroxCertifications.personId, personId),
            isNull(nitroxCertifications.deletedAt),
          ),
        ),
  ]);
  return {
    certifications: certificationRows,
    specialtyCertifications: specialtyRows,
    nitroxCertifications: nitroxRows,
  };
}

/**
 * **Many divers' live cert evidence at this shop, in three statements**: the
 * same three tables and the same `deleted_at` filters as
 * {@link readCertificationEvidence}, over a list of people, keyed by person.
 * A person with no rows gets empty lists, which is what the one-person read
 * returns for them. For a surface that weighs a list of candidates against
 * one departure (the invite suggestions), so a list of nine costs what a list
 * of one does instead of three reads each, one diver after another.
 */
export async function readCertificationEvidenceFor(
  tx: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<Map<string, TripAdmissionEvidence>> {
  const byPerson = new Map<string, TripAdmissionEvidence>();
  if (personIds.length === 0) return byPerson;
  const ids = [...new Set(personIds)];
  const [certificationRows, specialtyRows, nitroxRows] = await queryAll(tx, [
    () =>
      tx
        .select()
        .from(certifications)
        .where(
          and(
            eq(certifications.shopId, shopId),
            inArray(certifications.personId, ids),
            isNull(certifications.deletedAt),
          ),
        ),
    () =>
      tx
        .select()
        .from(specialtyCertifications)
        .where(
          and(
            eq(specialtyCertifications.shopId, shopId),
            inArray(specialtyCertifications.personId, ids),
            isNull(specialtyCertifications.deletedAt),
          ),
        ),
    () =>
      tx
        .select()
        .from(nitroxCertifications)
        .where(
          and(
            eq(nitroxCertifications.shopId, shopId),
            inArray(nitroxCertifications.personId, ids),
            isNull(nitroxCertifications.deletedAt),
          ),
        ),
  ]);
  for (const id of ids) {
    byPerson.set(id, {
      certifications: certificationRows.filter((row) => row.personId === id),
      specialtyCertifications: specialtyRows.filter((row) => row.personId === id),
      nitroxCertifications: nitroxRows.filter((row) => row.personId === id),
    });
  }
  return byPerson;
}
