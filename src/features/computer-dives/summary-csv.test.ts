import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import type { ParsedComputerDive } from "@/lib/computer-import";
import { computerHistorySummaryCsv } from "./summary-csv";

const record: Omit<ParsedComputerDive, "samples"> = {
  sourceFormat: "csv",
  sourceId: "source-1",
  device: "My logbook",
  localStart: null,
  localDate: "2026-11-01",
  startInstant: null,
  offsetMinutes: null,
  durationSeconds: null,
  maxDepthMeters: null,
  gases: [],
  tanks: [],
  warnings: ["date_only"],
  sourceUnits: { depth: "m", temperature: null, pressure: null },
  importSource: { provider: "padi", beta: true },
};
function read(recordInput = record, annotation = "") {
  return Papa.parse<Record<string, string>>(
    computerHistorySummaryCsv([{ id: "one", record: recordInput, annotation, deletedAt: null }]),
    { header: true, skipEmptyLines: true },
  ).data[0];
}
describe("portable computer-history CSV summary", () => {
  it("preserves unknown time, offset, duration and depth without fabricating midnight or zero", () => {
    const row = read();
    expect(row).toMatchObject({
      local_date: "2026-11-01",
      local_start: "",
      start_utc: "",
      utc_offset_minutes: "",
      duration_seconds: "",
      max_depth_m: "",
      chosen_logbook_source: "padi",
      compatibility: "beta",
    });
  });
  it("keeps known UTC separate from absent original local time", () => {
    const row = read({
      ...record,
      localDate: undefined,
      startInstant: "2026-11-02T04:00:00.000Z",
      durationSeconds: 0,
      maxDepthMeters: 0,
    });
    expect(row).toMatchObject({
      local_date: "",
      local_start: "",
      start_utc: "2026-11-02T04:00:00.000Z",
      duration_seconds: "0",
      max_depth_m: "0",
    });
  });
  it.each(["=1+1", "+SUM(1,2)", "-cmd", "@SUM(1)", "\t=1", "  =1", "\r+1", "\n@x", "\uFEFF=1"])(
    "neutralizes spreadsheet formulas in human-controlled cells: %j",
    (value) => {
      const row = read({ ...record, sourceId: value, device: value, archiveEntry: value }, value);
      for (const key of ["source_id", "computer", "archive_entry", "annotation"])
        expect(row[key]).toBe(`'${value}`);
    },
  );
  it("quotes commas/newlines and preserves deletion provenance without profiles or gas blobs", () => {
    const csv = computerHistorySummaryCsv([
      {
        id: "one",
        record,
        annotation: 'Two, lines\n"quoted"',
        deletedAt: new Date("2026-11-03T10:00:00Z"),
      },
    ]);
    const row = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
      .data[0];
    expect(row.annotation).toBe('Two, lines\n"quoted"');
    expect(row.deleted_at).toBe("2026-11-03T10:00:00.000Z");
    expect(Object.keys(row)).not.toContain("samples");
    expect(Object.keys(row)).not.toContain("gases");
  });
});
