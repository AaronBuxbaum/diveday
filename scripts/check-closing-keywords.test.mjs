import { describe, expect, it } from "vitest";
import {
  correctedForm,
  findUnkeyedClosingReferences,
  readBranchCommits,
} from "./check-closing-keywords.mjs";

const unkeyed = (text) => findUnkeyedClosingReferences(text).flatMap((finding) => finding.unkeyed);

describe("a closing reference GitHub will not act on", () => {
  /**
   * The two incidents this guard exists for, quoted from `git log origin/main`.
   * Both merged green on 2026-09-12; between them they closed #1392 and #1356
   * and left eight issues open over work that had shipped.
   */
  it("catches the list that left eight issues open", () => {
    expect(unkeyed("Closes #1392, #1393, #1395, #1506, #1511, #1632.")).toEqual([
      "1393",
      "1395",
      "1506",
      "1511",
      "1632",
    ]);
    expect(unkeyed("Closes #1356, #1394, #1497, #1498.")).toEqual(["1394", "1497", "1498"]);
  });

  it("names the one number the keyword does reach", () => {
    const [finding] = findUnkeyedClosingReferences("Closes #1356, #1394, #1497");
    expect(finding.closes).toBe("1356");
    expect(finding.unkeyed).toEqual(["1394", "1497"]);
  });

  it("catches `and` as well as a comma, in either spelling", () => {
    expect(unkeyed("Fixes #12 and #13")).toEqual(["13"]);
    expect(unkeyed("Fixes #12, and #13")).toEqual(["13"]);
    expect(unkeyed("Resolves #12, #13 and #14")).toEqual(["13", "14"]);
  });

  it("reads the keyword in any case, and every spelling GitHub accepts", () => {
    expect(unkeyed("CLOSES #1, #2")).toEqual(["2"]);
    expect(unkeyed("closed #1, #2")).toEqual(["2"]);
    expect(unkeyed("Fix #1, #2")).toEqual(["2"]);
    expect(unkeyed("resolve #1, #2")).toEqual(["2"]);
  });

  it("catches a second list later in the same message", () => {
    expect(unkeyed("Closes #1, #2\n\nSome prose.\n\nFixes #8, #9")).toEqual(["2", "9"]);
  });

  /**
   * The resume rule: once a list is consumed the scan restarts past it, so the
   * last number in a list can never be re-read as the start of another.
   */
  it("reports a list once, not once per number in it", () => {
    expect(findUnkeyedClosingReferences("Closes #1, #2, #3")).toHaveLength(1);
  });
});

describe("what it leaves alone", () => {
  it("passes the form GitHub actually acts on", () => {
    expect(unkeyed("Closes #1356\nCloses #1394\nCloses #1497")).toEqual([]);
    expect(unkeyed("Closes #12, Closes #13")).toEqual([]);
    expect(unkeyed("Closes #12 and closes #13")).toEqual([]);
  });

  /**
   * The reason the scan stops at anything that is not a comma or `and`. Half of
   * every message here is cross-reference, and a rule that read prose as a
   * closure would fail honest branches until somebody routed around it.
   */
  it("stops at a sentence boundary rather than claiming what follows", () => {
    expect(unkeyed("Closes #12. Related: #13, #14")).toEqual([]);
    expect(unkeyed("Closes #12 — the same defect as #13")).toEqual([]);
    expect(unkeyed("Closes #12\n\nFiled: #13, #14")).toEqual([]);
  });

  it("ignores a bare reference no keyword governs", () => {
    expect(unkeyed("See #1687, #1720 for the measurement")).toEqual([]);
    expect(unkeyed("Filed rather than widened: #1724, #1725, #1726")).toEqual([]);
    expect(unkeyed("Not closed: #1403 — it is measured and handed back")).toEqual([]);
  });

  it("ignores a word that merely ends in a keyword", () => {
    expect(unkeyed("Disclosed #12, #13")).toEqual([]);
    expect(unkeyed("Unfixes #12, #13")).toEqual([]);
  });

  it("passes a message with no closing reference at all", () => {
    expect(unkeyed("Two lobby links that cannot be minted in the same instant")).toEqual([]);
    expect(unkeyed("")).toEqual([]);
  });
});

describe("the corrected form it prints", () => {
  it("repeats the keyword once per issue, keeping the number that already closed", () => {
    const [finding] = findUnkeyedClosingReferences("Closes #1356, #1394, #1497, #1498.");
    expect(correctedForm(finding)).toBe("Closes #1356\nCloses #1394\nCloses #1497\nCloses #1498");
  });

  it("normalises the keyword's case so the suggestion is pasteable", () => {
    const [finding] = findUnkeyedClosingReferences("fixes #12, #13");
    expect(correctedForm(finding)).toBe("Fixes #12\nFixes #13");
  });
});

describe("reading the commits this branch adds", () => {
  const FORK = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const LOG = `log ${FORK}..HEAD --format=%H%x1f%s%x1f%B%x00`;

  /** A fake `git` keyed by the joined argv, the shape the guard passes. */
  const runner = (answers) => (args) => {
    const key = args.join(" ");
    return answers[key] ?? { ok: false, out: `unexpected: ${key}` };
  };

  const record = (sha, subject, message) => `${sha}\u001f${subject}\u001f${message}\u0000`;

  it("parses a multi-line message as one commit", () => {
    const read = readBranchCommits(
      runner({
        "rev-parse HEAD": { ok: true, out: "bbbb\n" },
        "merge-base origin/main HEAD": { ok: true, out: `${FORK}\n` },
        [LOG]: {
          ok: true,
          out: record("1234567890abcdef", "A subject", "A subject\n\nA body.\n\nCloses #12\n"),
        },
      }),
    );
    expect(read.ok).toBe(true);
    expect(read.commits).toHaveLength(1);
    expect(read.commits[0].sha).toBe("123456789");
    expect(read.commits[0].message).toContain("Closes #12");
  });

  it("falls back to `main` when there is no `origin/main`", () => {
    const read = readBranchCommits(
      runner({
        "rev-parse HEAD": { ok: true, out: "bbbb\n" },
        "merge-base origin/main HEAD": { ok: false, out: "unknown revision" },
        "merge-base main HEAD": { ok: true, out: `${FORK}\n` },
        [LOG]: { ok: true, out: "" },
      }),
    );
    expect(read).toEqual({ ok: true, commits: [] });
  });

  /**
   * A reason, not a skip: exit 2 is a deliberate one-off for the one guard that
   * makes a network call, and a clone this cannot read is one `pnpm
   * test:changed` and the destructive-migration guard cannot read either.
   */
  it("reports a reason naming the remedy when no trunk is reachable", () => {
    const read = readBranchCommits(
      runner({
        "rev-parse HEAD": { ok: true, out: "bbbb\n" },
        "merge-base origin/main HEAD": { ok: false, out: "unknown revision" },
        "merge-base main HEAD": { ok: false, out: "unknown revision" },
      }),
    );
    expect(read.ok).toBe(false);
    expect(read.reason).toContain("fetch-depth: 0");
  });

  it("reports a reason when the directory is not a git repository", () => {
    const read = readBranchCommits(runner({}));
    expect(read.ok).toBe(false);
    expect(read.reason).toContain("not a git repository");
  });

  /** On `main` the merge base is HEAD, so the range is empty and nothing is claimed. */
  it("reads an empty range as no commits rather than as a failure", () => {
    const read = readBranchCommits(
      runner({
        "rev-parse HEAD": { ok: true, out: `${FORK}\n` },
        "merge-base origin/main HEAD": { ok: true, out: `${FORK}\n` },
        [LOG]: { ok: true, out: "" },
      }),
    );
    expect(read).toEqual({ ok: true, commits: [] });
  });
});
