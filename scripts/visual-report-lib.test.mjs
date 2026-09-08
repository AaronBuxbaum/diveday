import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  BLIND_VERDICTS,
  COMMENT_MARKER,
  comparedAnything,
  countsLine,
  fetchFromBucket,
  formatPrComment,
  geometryLine,
  geometrySummaryLine,
  itemRows,
  PNG_SIGNATURE,
  readPngSize,
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

/** A minimal but real PNG header: signature, then an IHDR carrying the size. */
function pngOf(width, height) {
  const bytes = Buffer.alloc(24);
  PNG_SIGNATURE.copy(bytes, 0);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("readPngSize", () => {
  it("reads the dimensions out of the IHDR chunk", () => {
    expect(readPngSize(pngOf(1280, 1327))).toEqual({ width: 1280, height: 1327 });
    expect(readPngSize(pngOf(390, 12_000))).toEqual({ width: 390, height: 12_000 });
  });

  /**
   * This script reports on runs where something upstream already broke, so
   * every malformed input has to come back `null` rather than throw and take
   * the whole report down with it.
   */
  it("returns null for anything it cannot measure, and never throws", () => {
    expect(readPngSize(undefined)).toBeNull();
    expect(readPngSize(null)).toBeNull();
    expect(readPngSize("not a buffer")).toBeNull();
    expect(readPngSize(Buffer.alloc(0))).toBeNull();
    // Truncated mid-IHDR: the signature is right, the size is not there yet.
    expect(readPngSize(pngOf(1280, 1327).subarray(0, 20))).toBeNull();
    // A gzip member, i.e. the un-gunzipped path having gone wrong upstream.
    expect(readPngSize(gzipSync(Buffer.from("nope")))).toBeNull();
    // A PNG claiming a zero dimension is not a measurement.
    expect(readPngSize(pngOf(0, 1327))).toBeNull();
    expect(readPngSize(pngOf(1280, 0))).toBeNull();
  });
});

describe("geometryLine", () => {
  /**
   * The height delta is the whole point: the same growth as a sibling PR's
   * report of the same surface means the baseline moved under both, a different
   * growth means this branch did it. PR #1484 is the worked case — sixteen
   * captures carrying the feature's own 121px block were filed as somebody
   * else's noise, because a name list cannot tell those apart.
   */
  it("states the signed height delta when the capture grew or shrank", () => {
    expect(
      geometryLine({
        expected: { width: 1280, height: 1327 },
        actual: { width: 1280, height: 1569 },
      }),
    ).toBe("- geometry: expected 1280x1327 -> actual 1280x1569 (+242)");
    expect(
      geometryLine({
        expected: { width: 1280, height: 1569 },
        actual: { width: 1280, height: 1327 },
      }),
    ).toBe("- geometry: expected 1280x1569 -> actual 1280x1327 (-242)");
  });

  /** Said explicitly, because an omitted line reads as "nothing to report". */
  it("says so when the geometry did not move at all", () => {
    expect(
      geometryLine({
        expected: { width: 1280, height: 1327 },
        actual: { width: 1280, height: 1327 },
      }),
    ).toBe("- geometry: 1280x1327 unchanged");
  });

  it("names a width-only change rather than printing a zero delta", () => {
    expect(
      geometryLine({
        expected: { width: 1280, height: 1327 },
        actual: { width: 1300, height: 1327 },
      }),
    ).toBe("- geometry: expected 1280x1327 -> actual 1300x1327 (same height)");
  });

  /** A new or deleted item by design, or a download that 404'd. */
  it("reports one side alone without producing NaN", () => {
    expect(geometryLine({ actual: { width: 390, height: 800 } })).toBe(
      "- geometry: actual 390x800 (no expected image on disk)",
    );
    expect(geometryLine({ expected: { width: 390, height: 800 } })).toBe(
      "- geometry: expected 390x800 (no actual image on disk)",
    );
    expect(geometryLine({})).toBe("- geometry: unavailable (no images on disk)");
  });
});

describe("itemRows", () => {
  it("keeps the heading and file rows, and adds geometry beneath them", () => {
    expect(
      itemRows({
        name: "recap-light-vw-390.png",
        kind: "changed",
        files: { expected: "a/expected.png", actual: "a/actual.png", diff: "a/diff.png" },
        sizes: { expected: { width: 390, height: 800 }, actual: { width: 390, height: 921 } },
      }),
    ).toEqual([
      "## recap-light-vw-390.png (changed)",
      "- expected: a/expected.png",
      "- actual: a/actual.png",
      "- diff: a/diff.png",
      "- geometry: expected 390x800 -> actual 390x921 (+121)",
      "",
    ]);
  });

  /** A file that downloaded but could not be parsed is a different state from
   * a file that never arrived, and the reader has to be able to tell. */
  it("distinguishes an unreadable PNG from a missing one", () => {
    expect(
      itemRows({ name: "x.png", kind: "changed", files: { actual: "a/actual.png" }, sizes: {} }),
    ).toContain("- geometry: unreadable PNG");
    expect(itemRows({ name: "x.png", kind: "changed" })).toContain(
      "- geometry: unavailable (no images on disk)",
    );
  });
});

describe("geometrySummaryLine", () => {
  const changed = (expected, actual) => ({ kind: "changed", sizes: { expected, actual } });
  const at = (height) => ({ width: 1280, height });

  it("counts only the changed items whose height actually moved", () => {
    expect(
      geometrySummaryLine([
        changed(at(1327), at(1569)),
        changed(at(1327), at(1327)),
        changed(at(900), at(1021)),
        { kind: "new", sizes: { actual: at(400) } },
      ]),
    ).toBe("Geometry moved on 2 of 3 changed capture(s).");
  });

  /** AGENTS.md forbids a silent cap: an unmeasurable pair leaves the
   * denominator and says so, rather than quietly shrinking it. */
  it("names the pairs it could not measure instead of dropping them", () => {
    expect(geometrySummaryLine([changed(at(1327), at(1569)), { kind: "changed", sizes: {} }])).toBe(
      "Geometry moved on 1 of 1 changed capture(s). · 1 could not be measured",
    );
  });

  it("returns null when nothing changed, so the caller omits the line", () => {
    expect(geometrySummaryLine([])).toBeNull();
    expect(geometrySummaryLine([{ kind: "passed", sizes: {} }])).toBeNull();
  });
});
