import { expect, it } from "vitest";
import { prepareContactImport } from "./import";
import { sameImportIdentity } from "./import-identity";

it("normalizes presentation without inventing identity", () => {
  expect(sameImportIdentity("  JOSÉ   Senior ", "jose\u0301 senior")).toBe(true);
  for (const other of ["Senior José", "José Junior", "José", "Jose Senior", "Joe Senior"])
    expect(sameImportIdentity("José Senior", other)).toBe(false);
});
it("refuses the entire manually mapped email group but preserves trusted templates", () => {
  const body = "Father Senior,household@example.com\nDifferent Child,household@example.com";
  const manual = prepareContactImport(`Guest,Mailbox\n${body}`, {
    today: "2026-11-16",
    manual: { Guest: "full_name", Mailbox: "email" },
  });
  expect(manual.rows.map((row) => row.action)).toEqual(["skip", "skip"]);
  expect(manual.totals.importable).toBe(0);
  expect(manual.totals.merged).toBe(0);
  expect(
    prepareContactImport(`full_name,email\n${body}`, { today: "2026-11-16" }).rows.map(
      (row) => row.action,
    ),
  ).toEqual(["import", "merge"]);
});
