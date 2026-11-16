import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people } from "@/db/schema";
import type { PreparedImport } from "@/lib/import";

export type ImportRowOutcome = "create" | "update" | "merge" | "skip";

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
        .select({ email: people.email })
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
  return prepared.rows.map((row) => ({
    rowNumber: row.rowNumber,
    outcome:
      row.action === "skip"
        ? "skip"
        : row.action === "merge"
          ? "merge"
          : row.email && matches.has(row.email.toLowerCase())
            ? "update"
            : "create",
  }));
}
