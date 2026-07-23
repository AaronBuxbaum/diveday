import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildCsv, buildExportBundle, csvCell, exportFileName, zipExportBundle } from "./export";

describe("csv serialization", () => {
  it("escapes commas, quotes, and line breaks per RFC 4180", () => {
    expect(csvCell('Reef "Shark" Point')).toBe('"Reef ""Shark"" Point"');
    expect(csvCell("O'Malley, Sean")).toBe('"O\'Malley, Sean"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("neutralizes cells that would open as spreadsheet formulas", () => {
    // Diver-controlled text (a public booking's name) must never execute when
    // the owner opens the export in Excel/LibreOffice.
    expect(csvCell("=1+2")).toBe("'=1+2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-Dana")).toBe("'-Dana");
    expect(csvCell("+1 305 555 0100")).toBe("'+1 305 555 0100");
    // Composes with RFC-4180 quoting when the payload also carries a comma.
    expect(csvCell("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"');
    // Numbers are not diver-authored text and keep their sign.
    expect(csvCell(-500)).toBe("-500");
  });

  it("serializes empties, dates, booleans, and numbers unambiguously", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(new Date("2026-07-22T14:30:00Z"))).toBe("2026-07-22T14:30:00.000Z");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(0)).toBe("0");
  });

  it("builds a header-first CRLF document and rejects ragged rows", () => {
    const csv = buildCsv(["id", "name"], [["1", "Ada"]]);
    expect(csv).toBe("id,name\r\n1,Ada\r\n");
    expect(() => buildCsv(["id", "name"], [["only-one-cell"]])).toThrow(/cells/);
  });

  it("keeps an empty table as a header-only file, not a missing one", () => {
    expect(buildCsv(["id"], [])).toBe("id\r\n");
  });
});

describe("export bundle", () => {
  const input = {
    shopName: "Blue Mantis Dive Co.",
    shopSlug: "blue-mantis",
    timezone: "America/New_York",
    tables: [
      {
        file: "people.csv",
        header: ["id", "full_name"],
        rows: [
          ["p1", "Priya Sharma"],
          ["p2", "Sean O'Malley, Jr."],
        ],
        note: "Every person the shop knows.",
      },
      { file: "trips.csv", header: ["id"], rows: [], note: "Scheduled trips." },
    ],
  };
  const now = new Date("2026-07-22T14:30:00Z");

  it("names the zip for the shop and the shop-local date", () => {
    // 14:30Z is still 2026-07-22 in New York; a late-UTC instant would not be.
    expect(exportFileName("blue-mantis", now, "America/New_York")).toBe(
      "diveday-export-blue-mantis-2026-07-22.zip",
    );
    expect(
      exportFileName("blue-mantis", new Date("2026-07-23T02:30:00Z"), "America/New_York"),
    ).toBe("diveday-export-blue-mantis-2026-07-22.zip");
  });

  it("leads with a README manifest carrying counts, notes, and honest gaps", () => {
    const files = buildExportBundle(input, now);
    expect(files.map((file) => file.name)).toEqual(["README.txt", "people.csv", "trips.csv"]);
    const readme = files[0].content;
    expect(readme).toContain("Blue Mantis Dive Co. (blue-mantis)");
    expect(readme).toContain("Exported at: 2026-07-22T14:30:00.000Z");
    expect(readme).toContain("people.csv (2 rows): Every person the shop knows.");
    expect(readme).toContain("trips.csv (0 rows)");
    expect(readme).toContain("Not included in this bundle:");
  });

  it("round-trips through the zip byte-for-byte", () => {
    const files = buildExportBundle(input, now);
    const unzipped = unzipSync(zipExportBundle(files));
    expect(Object.keys(unzipped).sort()).toEqual(["README.txt", "people.csv", "trips.csv"]);
    expect(strFromU8(unzipped["people.csv"])).toBe(
      'id,full_name\r\np1,Priya Sharma\r\np2,"Sean O\'Malley, Jr."\r\n',
    );
  });
});
