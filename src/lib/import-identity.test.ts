import { expect, it } from "vitest";
import { prepareContactImport } from "./import";
import { sameImportIdentity } from "./import-identity";

it("normalizes presentation without inventing identity", () => {
  expect(sameImportIdentity("  JOSÉ   Senior ", "jose\u0301 senior")).toBe(true);
  for (const other of ["Senior José", "José Junior", "José", "Jose Senior", "Joe Senior"])
    expect(sameImportIdentity("José Senior", other)).toBe(false);
});
it("refuses shared-email identity conflicts in every mapping mode", () => {
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
  ).toEqual(["skip", "skip"]);
});

it("refuses assisted files with recognized identity headers and conflicting household names", () => {
  const prepared = prepareContactImport(
    "full_name,email,Extra\nFather Senior,shared@example.com,one\nDifferent Child,shared@example.com,two",
    {
      today: "2026-11-16",
      assist: { headers: { Extra: "internal_notes" }, levels: {} },
    },
  );
  expect(prepared.rows.map((row) => row.action)).toEqual(["skip", "skip"]);
});

it("skips nameless rows and refuses different identities sharing an email", () => {
  const csv = [
    "full_name,email",
    ",orphan@example.com",
    "First Wins,dupe@example.com",
    "Second Loses,DUPE@example.com",
  ].join("\n");
  const prepared = prepareContactImport(csv, { today: "2026-11-16" });
  expect(prepared.rows[0].action).toBe("skip"); // no name
  expect(prepared.rows[1].action).toBe("skip");
  expect(prepared.rows[2].action).toBe("skip");
  expect(prepared.rows[2].mergedIntoRow).toBeNull();
  expect(prepared.rows[1].issues).toContainEqual({
    level: "error",
    code: "manual_identity_conflict",
  });
  expect(prepared.totals).toMatchObject({ total: 3, importable: 0, merged: 0, skipped: 3 });
});
