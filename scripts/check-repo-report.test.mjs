import { describe, expect, it } from "vitest";

import { checkRepoRecord, checkRepoSummary } from "./check-repo-report.mjs";

const results = [
  { label: "tokens", scriptFile: "check-tokens.mjs", code: 0, stdout: "ok", stderr: "" },
  {
    label: "voice",
    scriptFile: "check-voice.mjs",
    code: 1,
    stdout: "",
    stderr: "src/a.tsx:3 says 'utilize'\nmore",
  },
];

describe("what check:repo leaves on CI", () => {
  it("names each failing guard with its first line", () => {
    expect(checkRepoSummary(results)).toBe(
      "### check:repo: 1 of 2 guards failed\n\n- `voice` (check-voice.mjs): src/a.tsx:3 says 'utilize'\n",
    );
    expect(checkRepoSummary(results.slice(0, 1))).toBe("check:repo: all 1 guards passed.\n");
  });

  it("records every guard as passed or failed, for a catch rate across runs", () => {
    expect(
      checkRepoRecord(results, { sha: "abc", ref: "main", at: new Date("2026-10-14T00:00:00Z") }),
    ).toEqual({
      sha: "abc",
      ref: "main",
      at: "2026-10-14T00:00:00.000Z",
      failed: ["voice"],
      passed: ["tokens"],
    });
  });
});
