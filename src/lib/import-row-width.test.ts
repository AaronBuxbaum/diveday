import { describe, expect, it } from "vitest";
import { prepareContactImport } from "@/test/import-fixture";
import {
  DIVE_SITE_CREATURE_IMPORT_COLUMNS,
  prepareDiveSiteCreaturesImport,
  prepareDiveSiteImport,
} from "./dive-site-import";
import { prepareGearImport } from "./gear-import";
import { MAX_IMPORT_COLUMNS } from "./import";

/**
 * The column bound holds on every row, not only the header (independent security review of
 * ADR 20261102-papaparse-csv-reader): a narrow header over a body row of a million commas
 * is refused before any row is mapped.
 */
const wide = (first: string) => `${first}${",".repeat(MAX_IMPORT_COLUMNS)}`;

describe("the column bound on body rows", () => {
  it("refuses a contacts file whose body row is wider than the limit", () => {
    const prepared = prepareContactImport(`full_name\nAda\n${wide("Grace")}`);
    expect(prepared.fatal).toEqual({
      code: "too_many_columns",
      params: { count: MAX_IMPORT_COLUMNS + 1, limit: MAX_IMPORT_COLUMNS },
    });
    expect(prepared.rows).toHaveLength(0);
  });

  it("refuses a gear file whose body row is wider than the limit", () => {
    const prepared = prepareGearImport(`gear_label\nBCD #1\n${wide("BCD #2")}`);
    expect(prepared.fatal).toBe("too_many_columns");
    expect(prepared.rows).toHaveLength(0);
  });

  it("refuses a dive-site file whose body row is wider than the limit", () => {
    const prepared = prepareDiveSiteImport(`name\nThe Wall\n${wide("The Arch")}`);
    expect(prepared.fatal).toBe("too_many_columns");
    expect(prepared.rows).toHaveLength(0);
  });

  it("refuses a dive-site creatures file whose body row is wider than the limit", () => {
    const header = DIVE_SITE_CREATURE_IMPORT_COLUMNS.join(",");
    const prepared = prepareDiveSiteCreaturesImport(`${header}\n${wide("x")}`);
    expect(prepared.fatal).toBe("too_many_columns");
    expect(prepared.rows).toHaveLength(0);
  });

  it("still takes a body row exactly as wide as the limit", () => {
    const atLimit = `Ada${",".repeat(MAX_IMPORT_COLUMNS - 1)}`;
    expect(prepareContactImport(`full_name\n${atLimit}`).fatal).toBeNull();
  });
});
