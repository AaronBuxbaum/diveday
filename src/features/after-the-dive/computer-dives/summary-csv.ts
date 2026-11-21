import Papa from "papaparse";
import type { ParsedComputerDive } from "@/lib/computer-import";

type SummaryRow = {
  id: string;
  record: Omit<ParsedComputerDive, "samples">;
  annotation: string;
  deletedAt: Date | string | null;
};

/** A labeled-unit summary; the existing JSON backup preserves profiles and complete provenance. */
export function computerHistorySummaryCsv(rows: readonly SummaryRow[]): string {
  const fields = [
    "record_id",
    "source_format",
    "chosen_logbook_source",
    "compatibility",
    "source_id",
    "computer",
    "computer_id",
    "local_date",
    "local_start",
    "start_utc",
    "utc_offset_minutes",
    "duration_seconds",
    "max_depth_m",
    "archive_entry",
    "annotation",
    "deleted_at",
  ];
  const data = rows.map(({ id, record, annotation, deletedAt }) => [
    id,
    record.sourceFormat,
    record.importSource?.provider ?? "",
    "beta",
    record.sourceId ?? "",
    record.device ?? "",
    record.deviceId ?? "",
    record.localDate ?? record.localStart?.slice(0, 10) ?? "",
    record.localStart ?? "",
    record.startInstant ?? "",
    record.offsetMinutes ?? "",
    record.durationSeconds ?? "",
    record.maxDepthMeters ?? "",
    record.archiveEntry ?? "",
    annotation,
    deletedAt instanceof Date ? deletedAt.toISOString() : (deletedAt ?? ""),
  ]);
  return Papa.unparse(
    { fields, data },
    {
      newline: "\r\n",
      escapeFormulae: /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u,
    },
  );
}
