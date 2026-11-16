import type { PreparedRow } from "./import";

/** Presentation normalization only: never infer household identity from an email. */
export function sameImportIdentity(left: string, right: string): boolean {
  const normalize = (name: string) =>
    name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return normalize(left) === normalize(right);
}

export function importIdentityConflicts(
  rows: PreparedRow[],
  existing: { email: string | null; fullName: string }[] = [],
): Set<string> {
  const names = new Map(
    existing.flatMap((person) =>
      person.email ? [[person.email.toLowerCase(), person.fullName] as const] : [],
    ),
  );
  const conflicts = new Set<string>();
  for (const row of rows) {
    if (!row.email || row.action === "skip") continue;
    const key = row.email.toLowerCase();
    const name = names.get(key);
    if (name !== undefined && !sameImportIdentity(name, row.fullName)) conflicts.add(key);
    else names.set(key, row.fullName);
  }
  return conflicts;
}

export function refuseImportIdentityConflicts(rows: PreparedRow[]): void {
  const conflicts = importIdentityConflicts(rows);
  for (const row of rows) {
    if (!row.email || !conflicts.has(row.email.toLowerCase())) continue;
    row.action = "skip";
    row.mergedIntoRow = null;
    row.issues.push({ level: "error", code: "manual_identity_conflict" });
  }
}

export function partitionImportRows(rows: PreparedRow[]) {
  refuseImportIdentityConflicts(rows);
  return {
    importable: rows.filter((row) => row.action === "import"),
    merged: rows.filter((row) => row.action === "merge"),
  };
}
