import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people } from "@/db/schema";
import type { PreparedImport } from "@/lib/import";
import { manualIdentityConflicts } from "@/lib/import-identity";

export type ImportRowOutcome = "create" | "update" | "merge" | "skip" | "conflict";

/** An advisory snapshot. Commit re-reads and locks matching people in its own transaction. */
export async function previewContactImportMatches(
  db: AppDb,
  shopId: string,
  prepared: PreparedImport,
): Promise<{ rowNumber: number; outcome: ImportRowOutcome }[]> {
  const emails = [
    ...new Set(
      prepared.rows.flatMap((row) =>
        row.action !== "skip" && row.email ? [row.email.toLowerCase()] : [],
      ),
    ),
  ];
  const existing = emails.length
    ? await db
        .select({ email: people.email, fullName: people.fullName })
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
  const conflicts = prepared.mapping.some((entry) => entry.manual)
    ? manualIdentityConflicts(prepared.rows, existing)
    : new Set<string>();
  return prepared.rows.map((row) => ({
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
  }));
}
