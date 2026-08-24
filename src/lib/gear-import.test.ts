import { describe, expect, it } from "vitest";
import { prepareGearImport } from "./gear-import";

describe("prepareGearImport", () => {
  it("recognizes the starter template and preserves service clocks", () => {
    const prepared = prepareGearImport([
      "gear_label,gear_kind,serial_number,service_kind,serviced_on,next_due_on,next_due_dives,service_note",
      "AL80-023,tank,AL80-023,hydro_test,2026-05-20,2031-05-20,,hydro passed",
    ].join("\n"));
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
    const prepared = prepareGearImport("gear_label,person_email,assigned_from,assigned_until,assignment_status\nBCD #14,alex@example.com,2026-06-01,2026-06-05,returned");
    expect(prepared.rows[0]).toMatchObject({ personEmail: "alex@example.com", assignedFrom: "2026-06-01", assignedUntil: "2026-06-05", assignmentStatus: "returned" });
    expect(prepared.rows[0]?.issues).toEqual([]);
  });
});
