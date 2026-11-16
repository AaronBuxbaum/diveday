import { describe, expect, it } from "vitest";
import { prepareContactImport } from "./import";
import { manualImportColumns, parseManualImportMapping } from "./import-manual-mapping";

const today = "2026-11-16";
const csv =
  "Guest,Mailbox,certification_level,certification_number,waiver_accepted\nAda Reef,ada@example.com,Open Water,OW-1,yes\nAda Reef,ada@example.com,Advanced Open Water,AOW-1,yes";

describe("local import mapping", () => {
  it("maps customer identity locally, merges repeated email rows, and downgrades evidence", () => {
    const manual = { Guest: "full_name", Mailbox: "email" } as const;
    const result = prepareContactImport(csv, { today, manual });
    expect(result.fatal).toBeNull();
    expect(result.rows[0]).toMatchObject({
      fullName: "Ada Reef",
      email: "ada@example.com",
      cert: { status: "pending" },
      waiver: null,
    });
    expect(result.rows[1].action).toBe("merge");
    expect(result.totals.withWaiver).toBe(0);
  });
  it("cannot remap recognized identity, sensitive columns, or trusted evidence", () => {
    expect(parseManualImportMapping('{"Guest":"waiver_accepted"}')).toBeNull();
    expect(parseManualImportMapping('{"Guest":"date_of_birth"}')).toBeNull();
    const manual = { Guest: "email", medical_answers: "full_name" } as const;
    const result = prepareContactImport(
      "full_name,email,Guest,medical_answers\nAda,ada@example.com,intruder@example.com,Someone Else",
      { today, manual },
    );
    expect(result.rows[0]).toMatchObject({ fullName: "Ada", email: "ada@example.com" });
  });
  it("offers only safe unclaimed columns and does not let two headers claim one field", () => {
    expect(
      manualImportColumns(
        "Guest,email,medical_answers,card_number\nAda,ada@example.com,asthma,123",
      ),
    ).toEqual(["Guest"]);
    const result = prepareContactImport("Guest,Other\nAda,Bob", {
      today,
      manual: { Guest: "full_name", Other: "full_name" },
    });
    expect(result.rows[0].fullName).toBe("Ada");
    expect(result.mapping.filter((entry) => entry.field === "full_name")).toHaveLength(1);
  });
});

it("exports only problem rows with spreadsheet formulas neutralized and RFC-4180 quoting", async () => {
  const { importRecoveryCsv } = await import("./import-manual-mapping");
  const source =
    'full_name,email\n"=HYPERLINK(""https://example.com"")",bad-email\nHealthy Diver,healthy@example.com';
  const prepared = prepareContactImport(source, { today });
  const output = importRecoveryCsv(source, prepared);
  expect(output).toContain("'=HYPERLINK");
  expect(output).toContain("email_invalid");
  expect(output).not.toContain("Healthy Diver");
});

it("keeps recovery row numbers aligned with blank rows and quoted multiline values", async () => {
  const { importRecoveryCsv } = await import("./import-manual-mapping");
  const source =
    '\nfull_name,email\n\n"Reef\nDiver",bad\n\nHealthy,healthy@example.com\n,missing@example.com\n';
  const result = prepareContactImport(source, { today });
  const recovery = importRecoveryCsv(source, result);
  expect(recovery).toContain('"Reef\nDiver",bad,1,email_invalid');
  expect(recovery).toContain("missing@example.com,3,no_name");
  expect(recovery).not.toContain("Healthy");
});

it("bundles local mapping and recovery for a browser without server-only dependencies", async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: ["src/lib/import-manual-mapping.ts"],
    bundle: true,
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  expect(result.errors).toEqual([]);
});

it("exports roster conflicts for correction with shared formula protection", async () => {
  const { importRecoveryCsv } = await import("./import-manual-mapping");
  const source = "Guest,Mailbox\n=Child,household@example.com\nHealthy,healthy@example.com";
  const prepared = prepareContactImport(source, {
    today,
    manual: { Guest: "full_name", Mailbox: "email" },
  });
  const recovery = importRecoveryCsv(source, prepared, [1]);
  expect(recovery).toContain("'=Child,household@example.com,1,manual_identity_conflict");
  expect(recovery).not.toContain("Healthy");
});
