import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findUnpinnedActions } from "./check-action-pins.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("findUnpinnedActions", () => {
  it("refuses a tag, a branch and a short SHA", () => {
    const text = [
      "      - uses: actions/checkout@v7",
      "        uses: corymhall/cdk-diff-action@main",
      "      - uses: actions/cache@3d3c42e",
    ].join("\n");
    expect(findUnpinnedActions("ci.yml", text)).toEqual([
      "ci.yml:1: actions/checkout@v7 is not pinned to a 40-character commit SHA",
      "ci.yml:2: corymhall/cdk-diff-action@main is not pinned to a 40-character commit SHA",
      "ci.yml:3: actions/cache@3d3c42e is not pinned to a 40-character commit SHA",
    ]);
  });

  it("refuses a pinned SHA that does not say which version it is", () => {
    expect(findUnpinnedActions("ci.yml", `      - uses: actions/checkout@${SHA}`)).toEqual([
      `ci.yml:1: actions/checkout@${SHA} has no version comment or permitted matching immutable-commit comment`,
    ]);
  });

  it("accepts a pinned SHA with its version, a sub-path action, and a local action", () => {
    const text = [
      `      - uses: actions/checkout@${SHA} # v7.0.1`,
      `        uses: actions/cache/restore@${SHA} # v6.1.0`,
      "      - uses: ./.github/actions/setup",
    ].join("\n");
    expect(findUnpinnedActions("ci.yml", text)).toEqual([]);
  });

  it("accepts an untagged immutable revision only when the comment repeats its SHA", () => {
    const otherSha = "4".repeat(40);
    expect(
      findUnpinnedActions(
        "ci.yml",
        `      - uses: AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@${SHA} # immutable commit ${SHA}`,
      ),
    ).toEqual([]);
    expect(
      findUnpinnedActions(
        "ci.yml",
        `      - uses: AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@${SHA} # immutable commit ${otherSha}`,
      ),
    ).toEqual([
      `ci.yml:1: AaronBuxbaum/diveday/.github/workflows/reg-suit-publish.yml@${SHA} has no version comment or permitted matching immutable-commit comment`,
    ]);
  });

  it("rejects immutable-commit comments for unrelated actions", () => {
    expect(
      findUnpinnedActions(
        "ci.yml",
        `      - uses: actions/checkout@${SHA} # immutable commit ${SHA}`,
      ),
    ).toEqual([
      `ci.yml:1: actions/checkout@${SHA} has no version comment or permitted matching immutable-commit comment`,
    ]);
  });

  it("refuses a docker image by tag and accepts one by digest", () => {
    const digest = "a".repeat(64);
    expect(findUnpinnedActions("x.yml", "  - uses: docker://alpine:3")).toHaveLength(1);
    expect(findUnpinnedActions("x.yml", `  - uses: docker://alpine@sha256:${digest}`)).toEqual([]);
  });
});

/** The real workflows, so a new unpinned `uses:` fails here as well as in check:repo. */
describe("the repository's workflows", () => {
  function files(dir) {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? files(full) : /\.ya?ml$/u.test(entry) ? [full] : [];
    });
  }

  it("pin every Action to a commit", () => {
    const problems = files(path.join(ROOT, ".github")).flatMap((full) =>
      findUnpinnedActions(path.relative(ROOT, full), readFileSync(full, "utf8")),
    );
    expect(problems).toEqual([]);
  });
});
