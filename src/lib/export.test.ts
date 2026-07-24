import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  buildCsv,
  buildExportBundle,
  csvCell,
  exportFileName,
  exportPhotoPath,
  fetchExportPhotos,
  zipExportBundle,
} from "./export";

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
    // A DDE-style payload needs letters/pipes after the sign — still guarded.
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    // Composes with RFC-4180 quoting when the payload also carries a comma.
    expect(csvCell("=SUM(A1,A2)")).toBe('"\'=SUM(A1,A2)"');
    // Numbers are not diver-authored text and keep their sign.
    expect(csvCell(-500)).toBe("-500");
  });

  it("passes phone-shaped strings through intact for import wizards", () => {
    // An E.164 number must reach a destination system unaltered — a purely
    // numeric cell can display as a number in a spreadsheet but never reach
    // a command payload, so fidelity wins here.
    expect(csvCell("+1 305 555 0100")).toBe("+1 305 555 0100");
    expect(csvCell("+44 (0) 20 7946 0958")).toBe("+44 (0) 20 7946 0958");
    expect(csvCell("-305.555.0100")).toBe("-305.555.0100");
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
    photoUrls: [],
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

  it("zips a Uint8Array photo file alongside the CSVs unmodified", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const files = [
      ...buildExportBundle(input, now),
      { name: "photos/cards/x.jpg", content: bytes },
    ];
    const unzipped = unzipSync(zipExportBundle(files));
    expect(unzipped["photos/cards/x.jpg"]).toEqual(bytes);
  });
});

describe("exportPhotoPath", () => {
  it("mirrors a managed blob URL's pathname under photos/", () => {
    expect(exportPhotoPath("https://xyz.public.blob.vercel-storage.com/recap/ab12-photo.jpg")).toBe(
      "photos/recap/ab12-photo.jpg",
    );
  });
});

describe("fetchExportPhotos", () => {
  const managed = "https://xyz.public.blob.vercel-storage.com/cards/a.jpg";

  it("fetches only managed-blob URLs, dedupes, and never touches an external or root-relative link", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array([9, 9]).buffer, { status: 200 }),
    );
    const photos = await fetchExportPhotos(
      [managed, managed, "https://evil.example.com/x.jpg", "/dive-sites/default.jpg"],
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(managed, expect.anything());
    expect(photos).toEqual([{ path: "photos/cards/a.jpg", bytes: new Uint8Array([9, 9]) }]);
  });

  it("drops a photo that fails to fetch rather than failing the whole export", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const photos = await fetchExportPhotos([managed], fetchImpl as unknown as typeof fetch);
    expect(photos).toEqual([]);
  });

  it("drops a photo whose fetch throws (network error, abort)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const photos = await fetchExportPhotos([managed], fetchImpl as unknown as typeof fetch);
    expect(photos).toEqual([]);
  });
});
