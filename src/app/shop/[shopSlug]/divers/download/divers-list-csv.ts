import { buildCsv, exportDateStamp } from "@/lib/export";

export type DiverListExportRow = {
  fullName: string;
  email: string | null;
  phone: string | null;
  lastDivedAt: Date | null;
};

const HEADER = ["Name", "Email", "Phone", "Last dived"];

/**
 * **"Download this list (CSV)"** (fourth UX review, item 27): one row per
 * diver on the roster as filtered and ordered, for a shop calling its lapsed
 * divers. The last dive is the shop's calendar day (`YYYY-MM-DD`), empty for
 * a diver who has never been out. `buildCsv` neutralises a cell that would
 * open as a spreadsheet formula.
 */
export function diversListCsv(rows: readonly DiverListExportRow[], timeZone: string): string {
  return buildCsv(
    HEADER,
    rows.map((row) => [
      row.fullName,
      row.email ?? "",
      row.phone ?? "",
      row.lastDivedAt ? exportDateStamp(row.lastDivedAt, timeZone) : "",
    ]),
  );
}
