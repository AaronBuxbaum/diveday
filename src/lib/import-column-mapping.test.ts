import { describe, expect, it } from "vitest";
import {
  importCorrectionCsv,
  mapImportColumns,
  parseImportColumnMapping,
} from "./import-column-mapping";

describe("explicit lossless import mapping", () => {
  it("maps repeated source headers by position and preserves quoted source values", () => {
    const result = mapImportColumns(
      'Tag,Tag\n"A,1",=danger()',
      ["gear_label", "service_note"],
      ["gear_label", "service_note"],
    );
    expect(result).toMatchObject({ csv: 'gear_label,service_note\r\n"A,1",=danger()' });
  });
  it.each([null, {}, ["name"], ["name", "name"], ["name", ""], ["name", "unknown"]])(
    "refuses missing, duplicate and unknown mappings %j",
    (mapping) => {
      expect(mapImportColumns("One,Two\nA,B", mapping, ["name", "description"])).toMatchObject({
        error: "invalid_mapping",
      });
    },
  );
  it("refuses extra unheaded data instead of silently dropping it", () => {
    expect(mapImportColumns("One\nA,B", ["name"], ["name"])).toMatchObject({
      error: "invalid_mapping",
    });
  });
  it("does not trust malformed mapping JSON", () => {
    expect(parseImportColumnMapping("{")).toBeNull();
    expect(parseImportColumnMapping(null)).toBeNull();
  });
  it("exports correction rows with safe formulas and the original source row", () => {
    expect(
      importCorrectionCsv(
        [
          ["name", "note"],
          ["=cmd()", "line\nbreak"],
        ],
        [{ rowNumber: 2, issues: ["missing_name"] }],
      ),
    ).toBe('source_row,issues,name,note\r\n2,missing_name,\'=cmd(),"line\nbreak"\r\n');
  });
});

it("bundles positional mapping and correction downloads for a browser", async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: ["src/lib/import-column-mapping.ts"],
    bundle: true,
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  expect(result.errors).toEqual([]);
});
