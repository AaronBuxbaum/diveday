import { describe, expect, it } from "vitest";
import { prepareContactImport } from "@/test/import-fixture";

describe("prepareContactImport — a waiver signed after the shop's today (issue #3781)", () => {
  /**
   * A signing date the shop's day has not reached (issue #3781): a dd/mm
   * system's `2026-12-03` for 12 March, or a date typed on purpose. Dating it
   * today instead would invent a signature; the claim is refused and the row's
   * other evidence still comes in.
   */
  it.each([
    ["the next day", "2026-10-23"],
    ["a dd/mm date read as mm/dd", "2026-12-03"],
    ["next decade", "2036-01-01"],
  ])("refuses a waiver signed %s, as an error", (_label, date) => {
    const csv = `full_name,waiver_accepted,waiver_signed_at\nFuture Fay,yes,${date}`;
    const prepared = prepareContactImport(csv);
    const [row] = prepared.rows;
    expect(row.waiver).toBeNull();
    expect(row.action).toBe("import");
    expect(row.issues).toContainEqual({
      level: "error",
      code: "waiver_date_future",
      params: { value: date },
    });
    expect(row.issues.some((i) => i.code === "waiver_imported")).toBe(false);
    expect(prepared.totals.withWaiver).toBe(0);
  });

  it("takes a waiver signed on the shop's today", () => {
    const csv = "full_name,waiver_accepted,waiver_signed_at\nToday Tam,yes,2026-10-22";
    const [row] = prepareContactImport(csv).rows;
    expect(row.waiver?.signedAt).toBe("2026-10-22");
    expect(row.issues.some((i) => i.code === "waiver_date_future")).toBe(false);
  });
});
