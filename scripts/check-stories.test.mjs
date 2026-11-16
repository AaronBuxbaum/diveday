import { describe, expect, it } from "vitest";

import { auditStories, parseMarkers, parseStories, renderReport } from "./check-stories.mjs";

const doc = [
  "# Front desk",
  "",
  "### DESK-01 Check a diver in",
  "**Done when**",
  "- one tap",
  "",
  "### DESK-02 Turn away a blocked diver",
  "**Gap:** #123 no test yet",
  "",
  "### DESK-03 A hint a person judges",
  "**Judged:** read it on the demo shop",
  "",
  "### DESK-04 Nobody owns this",
].join("\n");

const stories = parseStories(doc, "docs/product/stories/front-desk.md");
const spec = (...lines) => parseMarkers(lines.join("\n"), "e2e/a.spec.ts");

describe("check-stories", () => {
  it("reads ids, gaps and judged lines under the right story", () => {
    expect(stories.map((s) => [s.id, s.gap, s.judged])).toEqual([
      ["DESK-01", null, false],
      ["DESK-02", 123, false],
      ["DESK-03", null, true],
      ["DESK-04", null, false],
    ]);
    expect(stories[0].persona).toBe("Front desk");
  });

  it("accepts a marker above a test, past other comments, with several ids", () => {
    const markers = spec("// story: DESK-01, DESK-04", "// why", 'test("x", async () => {});');
    const { problems } = auditStories(stories, markers);
    expect(problems).toEqual([]);
  });

  it("names the story nobody owns", () => {
    const { problems } = auditStories(stories, []);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("DESK-04");
  });

  it("refuses an unknown id, a dangling marker, a skipped proof and a stale gap", () => {
    const markers = [
      ...spec("// story: NOPE-01", 'test("a", () => {});'),
      ...spec("// story: DESK-01", "const x = 1;"),
      ...spec("// story: DESK-04", 'test.skip("b", () => {});'),
      ...spec("// story: DESK-02", 'it("c", () => {});'),
    ];
    const text = auditStories(stories, markers).problems.join("\n");
    expect(text).toContain("NOPE-01 is not a story");
    expect(text).toContain("directly above");
    expect(text).toContain("skipped test");
    expect(text).toContain("delete its **Gap:** #123");
  });

  it("leaves a gap with an issue and a judged story alone, and reports them", () => {
    const markers = spec("// story: DESK-01, DESK-04", 'test("x", () => {});');
    const { problems, proof } = auditStories(stories, markers);
    expect(problems).toHaveLength(0);
    expect(renderReport(stories, proof)).toContain("gap #123");
  });

  it("refuses a gap line with no issue number and a duplicate id", () => {
    const bad = parseStories("# P\n### AB-01 One\n**Gap:** later\n### AB-01 Again\n", "p.md");
    const text = auditStories(bad, []).problems.join("\n");
    expect(text).toContain("names no issue");
    expect(text).toContain("also used");
  });
});
