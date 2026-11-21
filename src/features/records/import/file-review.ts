import { and, eq, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { diveSites, gearItems, gearServiceEvents } from "@/db/schema";
import type { PreparedGearImport } from "@/features/gear/gear-import";
import type {
  PreparedDiveSiteCreaturesImport,
  PreparedDiveSiteImport,
} from "@/features/sites/dive-sites";
import { MAX_SITE_CREATURES } from "@/lib/dive-site-field-guide";

export type FileReviewRow = {
  rowNumber: number;
  outcome: "create" | "update" | "duplicate" | "skip";
  issues: string[];
};

/** Advisory only. Existing writers re-read live tenant rows on every commit. */
export async function previewGearImport(
  db: AppDb,
  shopId: string,
  prepared: PreparedGearImport,
): Promise<FileReviewRow[]> {
  const items = await db
    .select()
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), isNull(gearItems.deletedAt)));
  const events = await db
    .select()
    .from(gearServiceEvents)
    .where(eq(gearServiceEvents.shopId, shopId));
  const seen = new Set<string>();
  const units = items.map(({ id, label, serialNumber }) => ({ id, label, serialNumber }));
  return prepared.rows.map((row) => {
    const unitRefused = row.issues.some((issue) => !issue.includes("assignment")) || !row.label;
    const item =
      units.find((item) => item.label === row.label) ??
      (row.serialNumber ? units.find((item) => item.serialNumber === row.serialNumber) : undefined);
    const unit = item ?? {
      id: `file:${row.rowNumber}`,
      label: row.label,
      serialNumber: row.serialNumber,
    };
    if (!unitRefused) {
      if (!item) units.push(unit);
      else item.serialNumber = row.serialNumber ?? item.serialNumber;
    }
    const key = JSON.stringify([unit.id, row.serviceKind, row.servicedOn, row.nextDueOn, row.note]);
    const duplicate = Boolean(
      row.servicedOn &&
        (seen.has(key) ||
          events.some(
            (event) =>
              event.gearItemId === item?.id &&
              event.kind === row.serviceKind &&
              event.servicedOn === row.servicedOn &&
              event.nextDueOn === row.nextDueOn &&
              event.note === row.note,
          )),
    );
    if (!unitRefused) seen.add(key);
    return {
      rowNumber: row.rowNumber,
      outcome: unitRefused ? "skip" : duplicate ? "duplicate" : item ? "update" : "create",
      issues: [...row.issues, ...(duplicate ? ["service_already_recorded"] : [])],
    };
  });
}

export async function previewDiveSiteImport(
  db: AppDb,
  shopId: string,
  prepared: PreparedDiveSiteImport,
): Promise<FileReviewRow[]> {
  const sites = await db
    .select({ id: diveSites.id, name: diveSites.name })
    .from(diveSites)
    .where(eq(diveSites.shopId, shopId));
  const seen = new Set<string>();
  return prepared.rows.map((row) => {
    const match =
      sites.find((site) => site.id === row.sourceId) ??
      sites.find((site) => site.name === row.name);
    const key = match?.id ?? row.name;
    const duplicate = seen.has(key);
    if (!row.issues.length) seen.add(key);
    return {
      rowNumber: row.rowNumber,
      outcome: row.issues.length ? "skip" : duplicate ? "duplicate" : match ? "update" : "create",
      issues: [...row.issues, ...(duplicate ? ["duplicate_in_file"] : [])],
    };
  });
}

/** Predict the existing guide writer's placement, order, duplicate and size rules. */
export function previewDiveSiteGuides(
  prepared: PreparedDiveSiteImport,
  sites: FileReviewRow[],
  guide: PreparedDiveSiteCreaturesImport,
): FileReviewRow[] {
  const placed = new Set(
    prepared.rows
      .filter((row) =>
        sites.some(
          (site) =>
            site.rowNumber === row.rowNumber &&
            site.outcome !== "skip" &&
            site.outcome !== "duplicate",
        ),
      )
      .flatMap((row) => (row.sourceId ? [row.sourceId] : [])),
  );
  const accepted = new Map<string, string[]>();
  const outcomes = new Map<number, FileReviewRow>();
  for (const row of [...guide.rows].sort(
    (a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      a.rowNumber - b.rowNumber,
  )) {
    const issues = [...row.issues];
    if (!issues.length && (!row.diveSiteId || !placed.has(row.diveSiteId)))
      issues.push("site_not_restored");
    if (!issues.length && row.diveSiteId && row.catalogSlug) {
      const slugs = accepted.get(row.diveSiteId) ?? [];
      if (slugs.includes(row.catalogSlug)) issues.push("duplicate_species");
      else if (slugs.length >= MAX_SITE_CREATURES) issues.push("too_many_species");
      else {
        slugs.push(row.catalogSlug);
        accepted.set(row.diveSiteId, slugs);
      }
    }
    outcomes.set(row.rowNumber, {
      rowNumber: row.rowNumber,
      outcome: issues.length ? "skip" : "update",
      issues,
    });
  }
  return guide.rows.map(
    (row) =>
      outcomes.get(row.rowNumber) ?? {
        rowNumber: row.rowNumber,
        outcome: "skip",
        issues: row.issues,
      },
  );
}
