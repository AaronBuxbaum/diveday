import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  fileProblems,
  pairProblems,
  staffPageWidths,
  staffWidthProblems,
} from "./check-staff-widths.mjs";

const MAIN = (cls) => `export default function Page() { return (<main className="${cls}" />); }`;

describe("fileProblems", () => {
  it("refuses a page that spells its own width", () => {
    const problems = fileProblems(
      "divers/page.tsx",
      MAIN("mx-auto w-full max-w-5xl flex-1 px-4 py-8"),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("max-w-5xl");
  });

  it("passes a page that declares the shell's width", () => {
    expect(fileProblems("divers/page.tsx", '<StaffPage width="full"><p /></StaffPage>')).toEqual(
      [],
    );
  });

  it("reads a width named in a comment as history, not a class", () => {
    const source = '/** It sat at `max-w-5xl` once. */\n// max-w-4xl\n<StaffPage width="full" />';
    expect(fileProblems("divers/page.tsx", source)).toEqual([]);
  });

  it("lets an allowlisted measure stand, and no more of them", () => {
    const one = '<p className="mt-2 max-w-3xl text-sm" />';
    expect(fileProblems("orders/page.tsx", one)).toEqual([]);
    expect(fileProblems("orders/page.tsx", one + one)).toHaveLength(1);
  });

  it("asks for the allowlist to shrink when a measure goes", () => {
    expect(fileProblems("orders/page.tsx", "<p />")[0]).toContain("shrink");
  });
});

describe("pairProblems", () => {
  it("passes a page and skeleton at one width, the default being reading", () => {
    expect(pairProblems("a/page.tsx", "<StaffPage>", '<StaffPage width="reading">')).toEqual([]);
  });

  it("refuses a skeleton at the other width", () => {
    expect(pairProblems("a/page.tsx", '<StaffPage width="full">', "<StaffPage>")).toHaveLength(1);
  });

  it("leaves a pair alone when either side draws its width elsewhere", () => {
    expect(pairProblems("a/page.tsx", "<SettingsEditorPage>", "<StaffPage>")).toEqual([]);
  });
});

describe("staffPageWidths", () => {
  it("reads every shell call, with its class added", () => {
    expect(
      staffPageWidths('<StaffPage width="full" className="animate-pulse"><StaffPage>'),
    ).toEqual(["full", "reading"]);
  });
});

describe("the staff tree", () => {
  it("holds every staff page to the two widths, with only the listed measures", async () => {
    const { problems, files, shells } = await staffWidthProblems();
    expect(problems).toEqual([]);
    expect(files).toBeGreaterThan(80);
    expect(shells).toBeGreaterThan(60);
    for (const { why } of ALLOWED.values()) expect(why.length).toBeGreaterThan(0);
  });
});
