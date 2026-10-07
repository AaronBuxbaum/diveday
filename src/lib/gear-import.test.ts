import { describe, expect, it } from "vitest";
import { prepareGearImport } from "./gear-import";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
} from "./import";

/**
 * **The four caps the contacts importer enforces** (issue #1846), from the
 * module this one borrows `parseCsv` from. Without them a 16 MB server-action
 * body of bare tags is hundreds of thousands of writes in one request.
 */
describe("prepareGearImport — explicit bounds (CR-016)", () => {
  it("rejects a file over the byte limit, with no rows", () => {
    const prepared = prepareGearImport(`gear_label\n${"x".repeat(MAX_IMPORT_BYTES + 1)}`);
    expect(prepared.fatal).toBe("file_too_large");
    expect(prepared.rows).toHaveLength(0);
  });

  it("rejects a file with more columns than the limit", () => {
    const headers = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, (_, i) => `col${i}`).join(",");
    const prepared = prepareGearImport(`gear_label,${headers}\nBCD #1,x`);
    expect(prepared.fatal).toBe("too_many_columns");
    expect(prepared.rows).toHaveLength(0);
  });

  it("rejects a file with more rows than the limit", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `BCD #${i}`).join("\n");
    const prepared = prepareGearImport(`gear_label\n${rows}`);
    expect(prepared.fatal).toBe("too_many_rows");
    expect(prepared.rows).toHaveLength(0);
  });

  it("accepts a file right at the row limit", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `BCD #${i}`).join("\n");
    const prepared = prepareGearImport(`gear_label\n${rows}`);
    expect(prepared.fatal).toBeNull();
    expect(prepared.rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it("rejects a single cell over the length limit instead of reading it", () => {
    const prepared = prepareGearImport(`gear_label\n${"x".repeat(MAX_IMPORT_CELL_LENGTH + 1)}`);
    expect(prepared.fatal).toBe("cell_too_long");
    expect(prepared.rows).toHaveLength(0);
  });

  it("rejects an over-long header cell too", () => {
    const prepared = prepareGearImport(`${"x".repeat(MAX_IMPORT_CELL_LENGTH + 1)}\nBCD #1`);
    expect(prepared.fatal).toBe("cell_too_long");
  });
});

describe("prepareGearImport", () => {
  it("recognizes the starter template and preserves service clocks", () => {
    const prepared = prepareGearImport(
      [
        "gear_label,gear_kind,serial_number,service_kind,serviced_on,next_due_on,next_due_dives,service_note",
        "AL80-023,tank,AL80-023,hydro_test,2026-05-20,2031-05-20,,hydro passed",
      ].join("\n"),
    );
    expect(prepared.fatal).toBeNull();
    expect(prepared.unmappedColumns).toEqual([]);
    expect(prepared.rows[0]).toMatchObject({
      label: "AL80-023",
      kind: "tank",
      serviceKind: "hydro_test",
      servicedOn: "2026-05-20",
      nextDueOn: "2031-05-20",
      note: "hydro passed",
    });
  });

  it("rejects service dive intervals without a due date", () => {
    const prepared = prepareGearImport("tag,service_date,next_due_dives\nBCD #1,2026-01-01,100");
    expect(prepared.rows[0]?.issues).toContain("dives_need_date");
  });
  it("recognizes historical assignments", () => {
    const prepared = prepareGearImport(
      "gear_label,person_email,assigned_from,assigned_until,assignment_status\nBCD #14,alex@example.com,2026-06-01,2026-06-05,returned",
    );
    expect(prepared.rows[0]).toMatchObject({
      personEmail: "alex@example.com",
      assignedFrom: "2026-06-01",
      assignedUntil: "2026-06-05",
      assignmentStatus: "returned",
    });
    expect(prepared.rows[0]?.issues).toEqual([]);
  });
});
