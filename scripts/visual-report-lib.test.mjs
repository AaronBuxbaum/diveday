import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  BLIND_VERDICTS,
  COMMENT_MARKER,
  comparedAnything,
  countsLine,
  fetchFromBucket,
  formatPrComment,
  summarizeReport,
  verdictHeadline,
} from "./visual-report-lib.mjs";

const COMMIT = "56696b7074aa18caf6b0af81d5c5f56fbea199a8";
const BUCKET = "diveday-vrt";

function items(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}-vw-390.png`);
}

/** The shape reg-suit publishes: filenames plus the four outcome buckets. */
function outJson({ failed = [], added = [], deleted = [], passed = [], expected }) {
  const actual = [...passed, ...failed, ...added];
  return {
    failedItems: failed,
    newItems: added,
    deletedItems: deleted,
    passedItems: passed,
    expectedItems: expected ?? [...passed, ...failed, ...deleted],
    actualItems: actual,
    actualDir: "actual",
    expectedDir: "expected",
    diffDir: "diff",
  };
}

function comment(report) {
  return formatPrComment({ commit: COMMIT, bucket: BUCKET, summary: summarizeReport(report) });
}

describe("summarizeReport", () => {
  it("calls a real comparison with no differences clean", () => {
    const summary = summarizeReport(outJson({ passed: items("about", 234) }));
    expect(summary.verdict).toBe("clean");
    expect(summary.comparedCount).toBe(234);
    expect(summary.baselineCount).toBe(234);
    expect(summary.changedCount).toBe(0);
  });

  it("reports changed, new, and deleted items with equal prominence", () => {
    const summary = summarizeReport(
      outJson({
        failed: ["trip-manage-dark-vw-390.png"],
        added: ["brand-new-light-vw-390.png"],
        deleted: ["gone-light-vw-1280.png"],
        passed: items("about", 10),
      }),
    );
    expect(summary.verdict).toBe("changes");
    // The headline count is all three categories, not just failedItems — a
    // surface that vanished or appeared is a pixel change someone must explain.
    expect(summary.changedCount).toBe(3);
    expect(summary.warnings).toHaveLength(2);
  });

  // The documented trap (ADR 20260729-reg-suit-visual-regression): baseline
  // resolution fails, every screenshot reports as `new`, and failedItems.length
  // is a reassuring zero while nothing was compared at all.
  it("flags the zero-failed/all-new baseline failure as having compared nothing", () => {
    const summary = summarizeReport(outJson({ added: items("about", 234), expected: [] }));
    expect(summary.changed).toHaveLength(0);
    expect(summary.verdict).toBe("no-baseline");
    expect(summary.comparedCount).toBe(0);
    expect(summary.baselineCount).toBe(0);
    expect(summary.capturedCount).toBe(234);
  });

  it("detects the same failure in a payload with no expectedItems field", () => {
    const legacy = {
      failedItems: [],
      newItems: items("about", 234),
      deletedItems: [],
      passedItems: [],
    };
    expect(summarizeReport(legacy).verdict).toBe("no-baseline");
  });

  it("distinguishes a missing report from a clean one", () => {
    expect(summarizeReport(null).verdict).toBe("no-report");
    expect(summarizeReport(outJson({ passed: items("about", 3) })).verdict).toBe("clean");
  });

  it("flags a run that captured nothing at all", () => {
    expect(summarizeReport(outJson({})).verdict).toBe("nothing-captured");
  });

  it("warns when baseline surfaces were never captured", () => {
    const summary = summarizeReport(
      outJson({ passed: items("about", 100), deleted: items("missing", 58) }),
    );
    expect(summary.warnings.join(" ")).toContain("not captured");
    expect(summary.warnings.join(" ")).toContain("58");
  });

  it("keeps the counts line pnpm visual:report has always printed", () => {
    const summary = summarizeReport(
      outJson({ failed: ["a.png"], added: ["b.png"], deleted: ["c.png"], passed: ["d.png"] }),
    );
    expect(countsLine(summary)).toBe("Changed: 1 · New: 1 · Deleted: 1 · Passed: 1");
  });
});

describe("verdictHeadline", () => {
  it("never says 'no differences' for a run that compared nothing", () => {
    for (const report of [
      null,
      outJson({ added: items("about", 234), expected: [] }),
      outJson({}),
    ]) {
      const headline = verdictHeadline(summarizeReport(report));
      expect(headline).not.toContain("no differences");
    }
  });

  it("says 'no differences' only when a baseline actually resolved", () => {
    expect(verdictHeadline(summarizeReport(outJson({ passed: items("about", 234) })))).toContain(
      "no differences across 234",
    );
  });
});

describe("formatPrComment", () => {
  it("carries a stable marker so the comment can be updated in place", () => {
    expect(comment(outJson({ passed: ["a.png"] })).startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("states plainly that a clean run was a real comparison", () => {
    const body = comment(outJson({ passed: items("about", 234) }));
    expect(body).toContain("compared **234**");
    expect(body).toContain("A baseline did resolve");
    expect(body).not.toContain("NOTHING WAS COMPARED");
  });

  it("shouts, and refuses to read as clean, when no baseline resolved", () => {
    const body = comment(outJson({ added: items("about", 234), expected: [] }));
    expect(body).toContain("NOTHING WAS COMPARED");
    expect(body).toContain("0 baseline images");
    expect(body).toContain('never as "no visual changes"');
    // The zero is still shown in the table, but the prose disowns it.
    expect(body).toContain("| 0 | 234 | 0 |");
    expect(body).not.toContain("no differences");
  });

  it("explains a missing out.json instead of implying a pass", () => {
    const body = comment(null);
    expect(body).toContain("no report was published");
    expect(body).toContain("nothing was compared");
    expect(body).toContain("fork PR");
    // No counts table: there are no counts, and a table of zeroes would read
    // exactly like a clean run.
    expect(body).not.toContain("| Changed |");
  });

  it("names changed surfaces and says how many it left out", () => {
    const body = comment(outJson({ failed: items("surface", 25), passed: items("about", 100) }));
    expect(body).toContain("**Changed** (25)");
    expect(body).toContain("`surface-0-vw-390.png`");
    expect(body).toContain("…and **15** more not listed here");
    expect(body).toContain("has all 25");
    // Bounded, not silently bounded: 10 named + one line accounting for 15.
    expect(body.match(/^- `surface-/gm)).toHaveLength(10);
  });

  it("lists every item when the count fits under the cap", () => {
    const body = comment(outJson({ failed: items("surface", 4), passed: items("about", 10) }));
    expect(body.match(/^- `surface-/gm)).toHaveLength(4);
    expect(body).not.toContain("more not listed here");
  });

  it("links both the agent path and the human report for the right commit", () => {
    const body = comment(outJson({ failed: ["a.png"], passed: ["b.png"] }));
    expect(body).toContain(`pnpm visual:report --commit ${COMMIT}`);
    expect(body).toContain(`https://${BUCKET}.s3.amazonaws.com/${COMMIT}/index.html`);
  });

  it("omits the report links when nothing was published to link to", () => {
    const body = comment(null);
    expect(body).not.toContain("Look at the pixels");
    expect(body).not.toContain("index.html");
  });

  it("headlines all three change categories, not just the changed one", () => {
    const body = comment(
      outJson({
        failed: ["a.png"],
        added: ["b.png"],
        deleted: ["c.png"],
        passed: items("about", 5),
      }),
    );
    expect(body).toContain("### Visual regression — 1 changed, 1 new, 1 deleted");
  });

  it("says outright that it never fails the build", () => {
    expect(comment(outJson({ failed: ["a.png"], passed: ["b.png"] }))).toContain(
      "never fails the build",
    );
  });
});

describe("fetchFromBucket", () => {
  function response(body, { ok = true, status = 200 } = {}) {
    return {
      ok,
      status,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
    };
  }

  it("decodes a gzipped body by magic number", async () => {
    const payload = JSON.stringify({ failedItems: [] });
    const result = await fetchFromBucket(BUCKET, "k/out.json", {
      fetchImpl: async () => response(gzipSync(Buffer.from(payload))),
    });
    expect(result.ok).toBe(true);
    expect(result.body.toString("utf8")).toBe(payload);
  });

  it("passes an already-decoded body through untouched", async () => {
    const payload = JSON.stringify({ failedItems: [] });
    const result = await fetchFromBucket(BUCKET, "k/out.json", {
      fetchImpl: async () => response(Buffer.from(payload)),
    });
    expect(result.body.toString("utf8")).toBe(payload);
  });

  it("reports a miss rather than throwing", async () => {
    const result = await fetchFromBucket(BUCKET, "k/out.json", {
      fetchImpl: async () => response(Buffer.alloc(0), { ok: false, status: 404 }),
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(result.url).toBe(`https://${BUCKET}.s3.amazonaws.com/k/out.json`);
  });
});

/**
 * `visual-report`'s final step turns this answer into a red check (issue #1137),
 * so a verdict slipping out of `BLIND_VERDICTS` is a run that compared nothing
 * going green again — the exact regression the step exists to prevent. Every
 * verdict `summarizeReport` can produce is pinned on one side or the other.
 */
describe("comparedAnything — what the CI gate reads", () => {
  it("refuses a report that was never published", () => {
    expect(comparedAnything(summarizeReport(null))).toBe(false);
  });

  it("refuses a run that captured nothing", () => {
    expect(comparedAnything(summarizeReport(outJson({})))).toBe(false);
  });

  it("refuses a run whose baseline never resolved, however reassuring its count", () => {
    // The documented lie: every screenshot reports as `new`, so `failedItems`
    // is a comforting zero while nothing was compared at all.
    const summary = summarizeReport(outJson({ added: items("about", 234), expected: [] }));
    expect(summary.changedCount).toBe(234);
    expect(summary.comparedCount).toBe(0);
    expect(comparedAnything(summary)).toBe(false);
  });

  it("accepts a clean comparison", () => {
    expect(comparedAnything(summarizeReport(outJson({ passed: items("about", 3) })))).toBe(true);
  });

  it("accepts a comparison that found differences — a diff warns, it never blinds", () => {
    const summary = summarizeReport(
      outJson({ failed: items("about", 2), passed: items("home", 5) }),
    );
    expect(summary.verdict).toBe("changes");
    expect(comparedAnything(summary)).toBe(true);
  });

  it("names every blind verdict, so a new one cannot be added silently", () => {
    expect(BLIND_VERDICTS).toEqual(["no-report", "nothing-captured", "no-baseline"]);
    for (const verdict of BLIND_VERDICTS) {
      expect(comparedAnything({ verdict })).toBe(false);
    }
  });
});

describe("the comment agrees with the check", () => {
  it("says a difference never fails the build when something was compared", () => {
    const body = comment(outJson({ failed: items("about", 2), passed: items("home", 5) }));
    expect(body).toContain("A visual difference never fails the build");
    expect(body).not.toContain("This fails the `visual-report` check");
  });

  it("says the check fails when nothing was compared", () => {
    // For years this paragraph read "informational and never fails the build"
    // on exactly the run where the check was about to go green over nothing.
    for (const report of [null, outJson({}), outJson({ added: items("a", 3), expected: [] })]) {
      const body = comment(report);
      expect(body).toContain("This fails the `visual-report` check");
      expect(body).not.toContain("A visual difference never fails the build");
    }
  });
});
