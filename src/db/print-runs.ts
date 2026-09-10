import { and, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type PrintRunSheetCode, printRunSubjectKey } from "@/lib/print-sheets";
import type { DbExecutor } from "./client";
import { type PrintSheetValue, shopPrintRuns } from "./schema";

/**
 * **When each of the shop's sheets was last printed** (ADR 20260908-one-hand,
 * decision 6, lever X).
 *
 * The register in Settings shows one date per row, and a sheet carries the same
 * date on its fold line. Everything else on a sheet is read from the page it is
 * a print of; this is the one fact paper cannot recover for itself.
 */

/**
 * The two vocabularies, pinned to each other. `src/lib/print-sheets.ts` is
 * framework-free and cannot import the schema; the database enum cannot import
 * the library. So a sheet added to one and not the other fails here, at compile
 * time, rather than at the first write.
 */
type SheetCodesAgree = PrintRunSheetCode extends PrintSheetValue
  ? PrintSheetValue extends PrintRunSheetCode
    ? true
    : never
  : never;
const _sheetCodesAgree: SheetCodesAgree = true;
void _sheetCodesAgree;

/** One row of the register: which sheet, which subject, and when. */
export type PrintRun = {
  sheet: PrintRunSheetCode;
  subjectKey: string;
  printedAt: Date;
};

/**
 * Every print run this shop has, keyed by `<sheet>:<subjectKey>` so a register
 * row is a lookup rather than a scan.
 *
 * Shop-scoped like every domain read: a boat card printed by one shop can never
 * date another's row.
 */
export async function printRunsByKey(
  db: DbExecutor,
  shopId: string,
): Promise<Map<string, PrintRun>> {
  const rows = await db
    .select({
      sheet: shopPrintRuns.sheet,
      subjectKey: shopPrintRuns.subjectKey,
      printedAt: shopPrintRuns.printedAt,
    })
    .from(shopPrintRuns)
    .where(eq(shopPrintRuns.shopId, shopId));
  return new Map(rows.map((row) => [printRunKey(row.sheet, row.subjectKey), row]));
}

/** The map key a register row looks itself up by. */
export function printRunKey(sheet: PrintRunSheetCode, subjectKey: string): string {
  return `${sheet}:${subjectKey}`;
}

/**
 * Record that a sheet was printed, now.
 *
 * An update-then-insert rather than an append: the register asks "when did we
 * last print this", which one row answers, and a trail would be an append-only
 * table wanting a retention window for a question nothing asks. The time comes
 * from `nowDate()` — the shop's clock, frozen under test — never from the
 * database's `defaultNow()`, so a printed date is the same instant the rest of
 * the request reads.
 *
 * The write is idempotent in the sense that matters: printing the dock sign
 * twice leaves one row carrying the later date.
 */
export async function recordPrintRun(
  db: DbExecutor,
  shopId: string,
  sheet: PrintRunSheetCode,
  subjectId?: string | null,
): Promise<void> {
  const subjectKey = printRunSubjectKey(subjectId);
  await db
    .insert(shopPrintRuns)
    .values({ shopId, sheet, subjectKey, printedAt: nowDate() })
    .onConflictDoUpdate({
      target: [shopPrintRuns.shopId, shopPrintRuns.sheet, shopPrintRuns.subjectKey],
      set: { printedAt: nowDate() },
    });
}

/** One row's date, for a register row or a sheet's fold line. */
export async function lastPrintedAt(
  db: DbExecutor,
  shopId: string,
  sheet: PrintRunSheetCode,
  subjectId?: string | null,
): Promise<Date | null> {
  const [row] = await db
    .select({ printedAt: shopPrintRuns.printedAt })
    .from(shopPrintRuns)
    .where(
      and(
        eq(shopPrintRuns.shopId, shopId),
        eq(shopPrintRuns.sheet, sheet),
        eq(shopPrintRuns.subjectKey, printRunSubjectKey(subjectId)),
      ),
    );
  return row?.printedAt ?? null;
}
