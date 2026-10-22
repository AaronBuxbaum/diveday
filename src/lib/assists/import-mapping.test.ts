import { describe, expect, it } from "vitest";
import { buildStructuredRequest, callStructured } from "@/lib/claude/structured";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { prepareContactImport } from "@/test/import-fixture";
import {
  importAssistFrom,
  importAssistSample,
  importMappingCall,
  maskSampleCell,
  parseImportAssist,
  SAMPLE_ROWS,
} from "./import-mapping";

const EXPORT = [
  "Name,Cust,E-Post,Lvl,Card #,Health notes,Card Number",
  "Ana López,C-1,ana@example.org,Fortgeschritten,PADI-123456,asthma,4111111111111111",
  "Ben Ito,C-2,ben@example.org,Sauveteur,PADI-654321,,",
  "Cleo Park,C-3,cleo@example.org,Open Water,SSI-777777,,",
].join("\n");

describe("maskSampleCell", () => {
  it("masks emails and long digit runs, keeps short words", () => {
    expect(maskSampleCell("ana@example.org")).toBe("name@example.com");
    expect(maskSampleCell("+1 (305) 555-0110")).toBe("+0 (000) 000-0000");
    expect(maskSampleCell("PADI-123456")).toBe("PADI-000000");
    expect(maskSampleCell("Size 42")).toBe("Size 42");
  });
});

describe("importAssistSample", () => {
  it("asks only about unknown columns, masked, and never about medical or payment-method columns", () => {
    const sample = importAssistSample(EXPORT);
    expect(sample?.columns.map((column) => column.header)).toEqual([
      "Cust",
      "E-Post",
      "Lvl",
      "Card #",
    ]);
    expect(sample?.columns[1]?.samples).toEqual(["name@example.com"]);
    expect(JSON.stringify(sample)).not.toContain("asthma");
    expect(JSON.stringify(sample)).not.toContain("4111");
    expect(JSON.stringify(sample)).not.toContain("123456");
  });

  it("leaves out a column whose header or values name health, in any language", () => {
    const sample = importAssistSample(
      [
        "Nom,Antécédents médicaux,Notas,Taille combi",
        "Lena,asthma,diabetes tipo 1,M",
        "Ari,none,,L",
      ].join("\n"),
    );
    expect(sample?.columns.map((column) => column.header)).toEqual(["Nom", "Taille combi"]);
    expect(JSON.stringify(sample)).not.toMatch(/asthma|diabetes|médicaux/);
  });

  it("reads at most the first rows, and a few values from each", () => {
    const rows = Array.from({ length: SAMPLE_ROWS + 20 }, (_, index) => `Diver ${index},x`);
    const sample = importAssistSample(["Cust,Note", ...rows].join("\n"));
    expect(sample?.columns[0]?.samples).toHaveLength(5);
    const late = importAssistSample(
      ["Name,Mystery", ...Array.from({ length: SAMPLE_ROWS }, () => "A,"), "B,secret"].join("\n"),
    );
    expect(JSON.stringify(late)).not.toContain("secret");
  });

  it("lists level spellings the importer cannot read, alone and joined to no row", () => {
    const sample = importAssistSample(
      ["Name,Level", "Ana,Fortgeschritten", "Ben,Open Water", "Cleo,Plongeur  Sauveteur"].join(
        "\n",
      ),
    );
    expect(sample).toEqual({
      columns: [],
      levelSpellings: ["fortgeschritten", "plongeur sauveteur"],
    });
  });

  it("has nothing to ask of a file the importer already reads", () => {
    expect(importAssistSample("Name,Email\nAna,ana@example.org")).toBeNull();
  });
});

describe("importMappingCall", () => {
  it("sends the sample on the quick model, with the mappable fields in the instructions", () => {
    const sample = importAssistSample(EXPORT);
    if (!sample) throw new Error("expected a sample");
    const request = buildStructuredRequest(importMappingCall(sample));
    expect(request.model).toBe("claude-haiku-5-5");
    expect(JSON.stringify(request.system)).not.toContain("waiver_accepted");
    expect(JSON.stringify(request.system)).toContain("certification_level");
  });

  it("refuses an answer that maps a column to a field it may not fill", async () => {
    const sample = importAssistSample(EXPORT);
    if (!sample) throw new Error("expected a sample");
    const provider = fakeClaude({
      reply: () =>
        fakeClaudeMessage({
          text: JSON.stringify({
            columns: [{ header: "Cust", field: "waiver_accepted" }],
            levels: [],
          }),
        }),
    });
    expect((await callStructured(provider, importMappingCall(sample))).value).toBeNull();
  });
});

describe("importAssistFrom", () => {
  it("keeps only what was asked, each field once, nothing mapped to none", () => {
    const sample = importAssistSample(EXPORT);
    if (!sample) throw new Error("expected a sample");
    expect(
      importAssistFrom(
        {
          columns: [
            { header: "Cust", field: "visit_reference" },
            { header: "E-Post", field: "none" },
            { header: "Lvl", field: "certification_level" },
            { header: "Card #", field: "certification_number" },
            { header: "Health notes", field: "internal_notes" },
            { header: "Other", field: "visit_reference" },
          ],
          levels: [
            { spelling: "Fortgeschritten", level: "advanced_open_water" },
            { spelling: "Stranger", level: "rescue" },
          ],
        },
        { ...sample, levelSpellings: ["fortgeschritten"] },
      ),
    ).toEqual({
      headers: {
        Cust: "visit_reference",
        Lvl: "certification_level",
        "Card #": "certification_number",
      },
      levels: { fortgeschritten: "advanced_open_water" },
    });
  });
});

describe("prepareContactImport with an assist", () => {
  const assist = {
    headers: {
      Cust: "visit_reference",
      Lvl: "certification_level",
      "Card #": "certification_number",
    },
    levels: { fortgeschritten: "advanced_open_water", sauveteur: "rescue" },
  } as const;

  it("maps the matched columns and marks them, and leaves medical and payment columns out", () => {
    const prepared = prepareContactImport(EXPORT, assist);
    expect(prepared.fatal).toBeNull();
    expect(prepared.mapping).toContainEqual({
      field: "visit_reference",
      header: "Cust",
      columnIndex: 1,
      assisted: true,
    });
    expect(prepared.ignoredMedicalColumns).toEqual(["Health notes"]);
    expect(prepared.mapping.map((entry) => entry.header)).not.toContain("Card Number");
  });

  it("never lets an assist say who a row is or how old they are", () => {
    const prepared = prepareContactImport(EXPORT.replace("Name,", "Kunde,"), {
      headers: { Kunde: "full_name", "E-Post": "email", Cust: "date_of_birth" },
      levels: {},
    } as unknown as Parameters<typeof prepareContactImport>[1]);
    expect(prepared.fatal?.code).toBe("no_name_column");
    const named = prepareContactImport(EXPORT, {
      headers: { "E-Post": "email", Cust: "date_of_birth" },
      levels: {},
    } as unknown as Parameters<typeof prepareContactImport>[1]);
    expect(named.mapping.filter((entry) => entry.assisted)).toEqual([]);
    expect(named.rows.every((row) => row.email === null && row.dateOfBirth === null)).toBe(true);
  });

  it("imports every card from an assisted card column as pending, never verified", () => {
    const prepared = prepareContactImport(EXPORT, assist);
    const certs = prepared.rows.map((row) => row.cert);
    expect(certs.map((cert) => cert?.level)).toEqual([
      "advanced_open_water",
      "rescue",
      "open_water",
    ]);
    expect(certs.every((cert) => cert?.status === "pending")).toBe(true);
  });

  it("names the glossary's level traps, and a rung read through one never imports verified", () => {
    const sample = importAssistSample(EXPORT);
    if (!sample) throw new Error("expected a sample");
    const system = JSON.stringify(buildStructuredRequest(importMappingCall(sample)).system);
    expect(system).toContain(
      '\\"Scuba Diver\\" is none. \\"Adventure Diver\\" is open_water. CMAS or national-federation stars are none.',
    );
    const file = [
      "Name,Certification Level,Certification Number",
      "Ana,PADI Scuba Diver,P-1",
      "Ben,Adventure Diver,P-2",
      "Cleo,CMAS 2 Star,P-3",
    ].join("\n");
    // Whatever rung a model gives these spellings, none of them lands verified.
    const prepared = prepareContactImport(file, {
      headers: {},
      levels: {
        "padi scuba diver": "open_water",
        "adventure diver": "advanced_open_water",
        "cmas 2 star": "advanced_open_water",
      },
    });
    for (const row of prepared.rows) expect(row.cert?.status ?? "none").not.toBe("verified");
  });

  it("reads a level only through an assisted spelling as pending, even from a known column", () => {
    const file = [
      "Name,Certification Level,Certification Number",
      "Ana,Fortgeschritten,P-1",
      "Ben,Open Water,P-2",
    ].join("\n");
    const prepared = prepareContactImport(file, {
      headers: {},
      levels: { fortgeschritten: "advanced_open_water" },
    });
    expect(prepared.rows.map((row) => [row.cert?.level, row.cert?.status])).toEqual([
      ["advanced_open_water", "pending"],
      ["open_water", "verified"],
    ]);
  });

  it("never lets an assist outrank an alias, or map a header to a field an alias already holds", () => {
    const prepared = prepareContactImport("Name,Cust\nAna,Ana L", {
      headers: { Name: "email", Cust: "full_name" },
      levels: {},
    });
    expect(prepared.mapping).toEqual([{ field: "full_name", header: "Name", columnIndex: 0 }]);
  });

  it("is the plain importer without one", () => {
    expect(prepareContactImport(EXPORT).mapping.some((entry) => entry.assisted)).toBe(false);
  });
});

describe("parseImportAssist", () => {
  it("reads a well-formed assist and refuses a field it may not fill", () => {
    expect(parseImportAssist('{"headers":{"Cust":"visit_reference"},"levels":{}}')).toEqual({
      headers: { Cust: "visit_reference" },
      levels: {},
    });
    expect(parseImportAssist('{"headers":{"Cust":"email"},"levels":{}}')).toBeUndefined();
    expect(parseImportAssist('{"headers":{"Cust":"waiver_accepted"},"levels":{}}')).toBeUndefined();
    expect(parseImportAssist("not json")).toBeUndefined();
    expect(parseImportAssist("")).toBeUndefined();
  });
});
