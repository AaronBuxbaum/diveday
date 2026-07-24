import { describe, expect, it } from "vitest";
import { certificationAgency, certificationLevel } from "@/db/schema";
import {
  IMPORT_AGENCIES,
  IMPORT_HONESTY_TABLE,
  IMPORT_LEVELS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  normalizeLevel,
  parseCsv,
  prepareContactImport,
} from "./import";

describe("parseCsv (RFC-4180)", () => {
  it("reads quoted fields, embedded commas, doubled quotes, and CRLF", () => {
    const text = 'a,b,c\r\n"x,y","she said ""hi""",z\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x,y", 'she said "hi"', "z"],
    ]);
  });

  it("handles bare LF, a trailing row without a newline, and a leading BOM", () => {
    const text = "﻿name,email\nAda\n";
    expect(parseCsv(text)).toEqual([["name", "email"], ["Ada"]]);
  });

  it("keeps embedded newlines inside quotes", () => {
    expect(parseCsv('a\n"line1\nline2",b\n')).toEqual([["a"], ["line1\nline2", "b"]]);
  });
});

describe("enum arrays stay in step with the schema", () => {
  it("agencies and levels mirror the pg enums", () => {
    expect([...IMPORT_AGENCIES]).toEqual([...certificationAgency.enumValues]);
    expect([...IMPORT_LEVELS]).toEqual([...certificationLevel.enumValues]);
  });
});

describe("normalizeLevel", () => {
  it("maps agency dialects onto ladder rungs, advanced before open water", () => {
    expect(normalizeLevel("Advanced Open Water")).toBe("advanced_open_water");
    expect(normalizeLevel("AOW")).toBe("advanced_open_water");
    expect(normalizeLevel("Open Water Diver")).toBe("open_water");
    expect(normalizeLevel("OW")).toBe("open_water");
    expect(normalizeLevel("Rescue Diver")).toBe("rescue");
    expect(normalizeLevel("Divemaster")).toBe("divemaster");
    expect(normalizeLevel("Master Scuba Diver")).toBeNull();
    expect(normalizeLevel("")).toBeNull();
  });
});

describe("prepareContactImport — mapping", () => {
  it("auto-maps rival header dialects and flags medical + unmapped columns", () => {
    const csv = [
      "First Name,Last Name,E-mail,Cell,Cert Level,Cert Number,Medical Notes,Loyalty Tier",
      "Ada,Lovelace,ada@example.com,305-555-0101,Open Water,OW-1,none,gold",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.fatal).toBeNull();
    const fields = prepared.mapping.map((m) => m.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "first_name",
        "last_name",
        "email",
        "phone",
        "certification_level",
        "certification_number",
      ]),
    );
    expect(prepared.ignoredMedicalColumns).toContain("Medical Notes");
    expect(prepared.unmappedColumns).toContain("Loyalty Tier");
  });

  it("is fatal when no name column is present", () => {
    const prepared = prepareContactImport("email,phone\nada@example.com,305");
    expect(prepared.fatal).toMatch(/name column/i);
    expect(prepared.rows).toHaveLength(0);
  });

  it("assembles a full name from first + last", () => {
    const prepared = prepareContactImport("first_name,last_name\nGrace,Hopper");
    expect(prepared.rows[0]).toMatchObject({ fullName: "Grace Hopper", action: "import" });
  });
});

describe("prepareContactImport — explicit bounds (CR-016)", () => {
  it("rejects a file over the byte limit with a friendly reason and no rows", () => {
    const oversizedName = "x".repeat(MAX_IMPORT_BYTES + 1);
    const prepared = prepareContactImport(`full_name\n${oversizedName}`);
    expect(prepared.fatal).toMatch(/too large/i);
    expect(prepared.rows).toHaveLength(0);
  });

  it("rejects a file with more columns than the limit", () => {
    const headers = Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, (_, i) => `col${i}`).join(",");
    const prepared = prepareContactImport(`full_name,${headers}\nAda,x`);
    expect(prepared.fatal).toMatch(/too many columns/i);
  });

  it("rejects a file with more rows than the limit", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Diver ${i}`).join("\n");
    const prepared = prepareContactImport(`full_name\n${rows}`);
    expect(prepared.fatal).toMatch(/too many rows/i);
    expect(prepared.rows).toHaveLength(0);
  });

  it("accepts a file right at the row limit", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `Diver ${i}`).join("\n");
    const prepared = prepareContactImport(`full_name\n${rows}`);
    expect(prepared.fatal).toBeNull();
    expect(prepared.rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it("rejects a single cell over the length limit instead of silently truncating it", () => {
    const hugeCell = "x".repeat(MAX_IMPORT_CELL_LENGTH + 1);
    const prepared = prepareContactImport(`full_name\n${hugeCell}`);
    expect(prepared.fatal).toMatch(/longer than/i);
    expect(prepared.rows).toHaveLength(0);
  });
});

describe("prepareContactImport — safety rules", () => {
  it("imports a card as claimed and never trusts a source 'verified' flag", () => {
    const csv = [
      "full_name,certification_agency,certification_level,certification_number,certification_status",
      "Jacques Cousteau,PADI,Rescue Diver,RES-42,verified",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toEqual({ agency: "padi", level: "rescue", identifier: "RES-42" });
    // The plan carries no verified state anywhere — the DB default (pending) stands.
    expect(JSON.stringify(row.cert)).not.toMatch(/verified/);
    expect(row.issues.some((i) => /claimed/i.test(i.message) && /verified/i.test(i.message))).toBe(
      true,
    );
  });

  it("never fabricates a card number: a level with no number imports no card", () => {
    const csv = "full_name,certification_level\nMarie Tharp,Open Water";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toBeNull();
    expect(row.issues.some((i) => i.level === "warning" && /no card number/i.test(i.message))).toBe(
      true,
    );
  });

  it("leaves an unrecognized level for a human, importing the person anyway", () => {
    const csv = "full_name,certification_level,certification_number\nEugenie Clark,Tec 40,T-40";
    const [row] = prepareContactImport(csv).rows;
    expect(row.action).toBe("import");
    expect(row.cert).toBeNull();
    expect(row.issues.some((i) => /isn't a level/i.test(i.message))).toBe(true);
  });

  it("maps an unknown agency to 'other' rather than dropping the card", () => {
    const csv =
      "full_name,certification_agency,certification_level,certification_number\nSylvia Earle,CMAS,Divemaster,DM-9";
    const [row] = prepareContactImport(csv).rows;
    expect(row.cert).toMatchObject({ agency: "other", level: "divemaster" });
  });

  it("imports nitrox as a claimed card only with a card number", () => {
    const withNumber = prepareContactImport(
      "full_name,nitrox_certified,nitrox_certification_number\nA Diver,yes,NX-1",
    ).rows[0];
    expect(withNumber.nitrox).toEqual({ agency: "other", identifier: "NX-1" });

    const flagOnly = prepareContactImport("full_name,nitrox_certified\nB Diver,yes").rows[0];
    expect(flagOnly.nitrox).toBeNull();
    expect(flagOnly.issues.some((i) => /add and verify a nitrox card/i.test(i.message))).toBe(true);
  });

  it("drops a malformed email so it can't mis-match a diver on dedup", () => {
    const [row] = prepareContactImport("full_name,email\nBad Row,not-an-email").rows;
    expect(row.email).toBeNull();
    expect(row.issues.some((i) => /doesn't look valid/i.test(i.message))).toBe(true);
  });

  it("skips a nameless row and de-dupes repeated emails within the file", () => {
    const csv = [
      "full_name,email",
      ",orphan@example.com",
      "First Wins,dupe@example.com",
      "Second Loses,DUPE@example.com",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.rows[0].action).toBe("skip"); // no name
    expect(prepared.rows[1].action).toBe("import");
    expect(prepared.rows[2].action).toBe("skip"); // duplicate email (case-insensitive)
    expect(prepared.totals).toMatchObject({ total: 3, importable: 1, skipped: 2 });
  });

  it("round-trips a cell the export guarded against spreadsheet-formula injection", () => {
    // export.ts prefixes a leading '=' with an apostrophe; the importer strips it.
    const [row] = prepareContactImport("full_name\n'=cmd").rows;
    expect(row.fullName).toBe("=cmd");
  });

  it("counts cards and nitrox only among importable rows", () => {
    const csv = [
      "full_name,email,certification_level,certification_number,nitrox_certified,nitrox_certification_number",
      "Keep,keep@example.com,Open Water,OW-1,yes,NX-1",
      ",skip@example.com,Open Water,OW-2,yes,NX-2",
    ].join("\n");
    const prepared = prepareContactImport(csv);
    expect(prepared.totals).toMatchObject({ importable: 1, withCard: 1, withNitrox: 1 });
  });

  it("trusts a truthy waiver_accepted and carries the source label and document URLs through", () => {
    const csv = [
      "full_name,waiver_accepted,waiver_signed_at,waiver_source_name,waiver_document_url,medical_document_url",
      "Wanda Waiver,yes,2025-01-15,Old Shop,https://old.example.com/w.jpg,https://old.example.com/m.jpg",
    ].join("\n");
    const [row] = prepareContactImport(csv).rows;
    expect(row.waiver).toEqual({
      signedAt: "2025-01-15",
      sourceLabel: "Old Shop",
      documentUrl: "https://old.example.com/w.jpg",
      medicalDocumentUrl: "https://old.example.com/m.jpg",
    });
    expect(
      row.issues.some((i) =>
        /trusted from the prior shop, including medical clearance/.test(i.message),
      ),
    ).toBe(true);
  });

  it("leaves waiver null when waiver_accepted is absent or falsy", () => {
    expect(
      prepareContactImport("full_name,waiver_accepted\nNo Claim,no").rows[0].waiver,
    ).toBeNull();
    expect(prepareContactImport("full_name\nNo Column").rows[0].waiver).toBeNull();
  });

  it("drops an unparseable waiver_signed_at rather than misdating legal evidence", () => {
    const csv = "full_name,waiver_accepted,waiver_signed_at\nBad Date,yes,not-a-real-date";
    const [row] = prepareContactImport(csv).rows;
    expect(row.waiver).toMatchObject({ signedAt: null });
    expect(row.issues.some((i) => /isn't a real calendar date/.test(i.message))).toBe(true);
  });

  it("rejects an impossible calendar date the same way a malformed one is rejected", () => {
    const csv = "full_name,waiver_accepted,waiver_signed_at\nFeb Bad,yes,2025-02-31";
    const [row] = prepareContactImport(csv).rows;
    expect(row.waiver?.signedAt).toBeNull();
  });

  it("counts waivers only among importable rows", () => {
    const csv = [
      "full_name,email,waiver_accepted",
      "Keep,keep@example.com,yes",
      ",skip@example.com,yes",
    ].join("\n");
    expect(prepareContactImport(csv).totals.withWaiver).toBe(1);
  });
});

describe("IMPORT_HONESTY_TABLE", () => {
  it("states payment as never-imported", () => {
    const never = IMPORT_HONESTY_TABLE.filter((row) => row.scope === "never").map((r) => r.what);
    expect(never).toEqual(expect.arrayContaining(["Card on file / payment"]));
  });

  it("states waiver/medical acceptance as trusted (partial), never claiming full or silent", () => {
    const waiver = IMPORT_HONESTY_TABLE.find(
      (r) => r.what === "Signed waivers & medical clearance",
    );
    expect(waiver?.scope).toBe("partial");
    expect(waiver?.detail).toMatch(/trust/i);
    expect(waiver?.detail).toMatch(/imported/i);
  });

  it("marks certifications and nitrox partial (claimed, never verified)", () => {
    const cert = IMPORT_HONESTY_TABLE.find((r) => r.what === "Certification card");
    expect(cert?.scope).toBe("partial");
    expect(cert?.detail).toMatch(/never verified/i);
  });
});
