import { describe, expect, it } from "vitest";
import { buildCsv } from "../../../lib/csv";
import { prepareDiveSiteCreaturesImport, prepareDiveSiteImport } from "./dive-site-import.rules";

/** What the export guards (a leading sign, blank or full-width sign) comes back as typed. */
describe("re-importing our own dive-site export", () => {
  it.each(["=SUM(A1)", "@reef", "+cmd|x", "-1+cmd", "  =x", "＝x", "'Tis the reef"])(
    "returns %j unchanged",
    (original) => {
      const csv = buildCsv(["name", "description"], [["Reef", original]]);
      const prepared = prepareDiveSiteImport(csv);
      expect(prepared.rows[0]?.description).toBe(original.trim());
    },
  );

  it("unguards the site name too", () => {
    const csv = buildCsv(["name"], [["=Reef"]]);
    expect(prepareDiveSiteImport(csv).rows[0]?.name).toBe("=Reef");
  });

  it("unguards a creature row's site key", () => {
    const csv = buildCsv(["dive_site_id", "catalog_slug"], [["=site-1", "manta-ray"]]);
    const prepared = prepareDiveSiteCreaturesImport(csv);
    expect(prepared.rows[0]).toMatchObject({ diveSiteId: "=site-1" });
  });
});
