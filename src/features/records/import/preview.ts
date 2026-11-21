import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, priorVisits } from "@/db/schema";
import type { PreparedImport } from "@/lib/import";
import { importIdentityConflicts } from "@/lib/import-identity";

export type VisitImportOutcome = "add" | "existing" | "duplicate" | "skip";
export type ImportMatchRow = {
  rowNumber: number;
  outcome: ImportRowOutcome;
  visitOutcome?: VisitImportOutcome;
};

export type ImportRowOutcome = "create" | "update" | "merge" | "skip" | "conflict";

/** An advisory snapshot. Commit re-reads and locks matching people in its own transaction. */
export async function previewContactImportMatches(
  db: AppDb,
  shopId: string,
  prepared: PreparedImport,
): Promise<ImportMatchRow[]> {
  const emails = [
    ...new Set(
      prepared.rows.flatMap((row) =>
        row.action !== "skip" && row.email ? [row.email.toLowerCase()] : [],
      ),
    ),
  ];
  const existing = emails.length
    ? await db
        .select({ id: people.id, email: people.email, fullName: people.fullName })
        .from(people)
        .where(
          and(
            eq(people.shopId, shopId),
            isNull(people.deletedAt),
            inArray(sql`lower(${people.email})`, emails),
          ),
        )
    : [];
  const matches = new Set(
    existing.flatMap((person) => (person.email ? [person.email.toLowerCase()] : [])),
  );
  const conflicts = importIdentityConflicts(prepared.rows, existing);
  const personIds = existing.map((person) => person.id);
  const visits = personIds.length
    ? await db
        .select({ personId: priorVisits.personId, dedupeKey: priorVisits.dedupeKey })
        .from(priorVisits)
        .where(and(eq(priorVisits.shopId, shopId), inArray(priorVisits.personId, personIds)))
    : [];
  const seenVisits = new Set<string>();
  return prepared.rows.map((row) => {
    const refused =
      row.action === "skip" ||
      Boolean(row.email && conflicts.has(row.email.toLowerCase())) ||
      row.issues.some((issue) => issue.code === "manual_identity_conflict");
    let visitOutcome: VisitImportOutcome | undefined;
    if (row.visit) {
      const person = existing.find(
        (person) => person.email?.toLowerCase() === row.email?.toLowerCase(),
      );
      // Match the commit identity, never a name alone; email-less rows create
      // separate people and cannot safely be collapsed in a preview.
      const identity = row.email?.toLowerCase() ?? `row:${row.rowNumber}`;
      const key = JSON.stringify([identity, row.visit.dedupeKey]);
      visitOutcome = refused
        ? "skip"
        : visits.some(
              (visit) => visit.personId === person?.id && visit.dedupeKey === row.visit?.dedupeKey,
            )
          ? "existing"
          : seenVisits.has(key)
            ? "duplicate"
            : "add";
      if (!refused) seenVisits.add(key);
    }
    return {
      ...(visitOutcome ? { visitOutcome } : {}),
      rowNumber: row.rowNumber,
      outcome:
        (row.email && conflicts.has(row.email.toLowerCase())) ||
        row.issues.some((issue) => issue.code === "manual_identity_conflict")
          ? "conflict"
          : row.action === "skip"
            ? "skip"
            : row.action === "merge"
              ? "merge"
              : row.email && matches.has(row.email.toLowerCase())
                ? "update"
                : "create",
    };
  });
}
