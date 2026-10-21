import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { collectCaptureNames, deriveCoverage } from "./check-route-coverage.mjs";
import { selectCaptureFiles } from "./visual-affected.mjs";
import { captureBuildBoundary, matchesRoute, writeCaptureEvidence } from "./visual-evidence.mjs";
import { visualSpecs } from "./visual-specs.mjs";

test("discovers every visual spec and attributes routes only to captures", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visual-specs-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "e2e"));
  const sources = new Map([
    [
      "visual.spec.ts",
      'test("a", async ({ page }) => { await page.goto("/a"); await capture(page, "a"); });',
    ],
    [
      "visual-sites.spec.ts",
      'test("b", async ({ page }) => { await page.goto("/b"); await capture(page, "b"); });',
    ],
    ["booking.spec.ts", 'test("book", async ({ page }) => { await page.goto("/a"); });'],
  ]);
  for (const [file, source] of sources) writeFileSync(path.join(root, "e2e", file), source);
  expect(visualSpecs(root)).toEqual(["e2e/visual-sites.spec.ts", "e2e/visual.spec.ts"]);
  expect([...(await collectCaptureNames(root))].sort()).toEqual(["a", "b"]);
  const coverage = deriveCoverage({ routes: ["/a", "/b"], specSources: sources });
  expect([...coverage.get("/b").visual]).toEqual(["b"]);
  expect([...coverage.get("/b").e2e]).toEqual([]);
});

test("selection keeps line numbers and edited captures local to their domain file", () => {
  const files = ["e2e/visual.spec.ts", "e2e/visual-sites.spec.ts"];
  const sources = new Map(
    files.map((file, i) => [
      file,
      `test("${i}", async ({page})=>{\n await page.goto("/${i}");\n await capture(page,"${i}");\n});`,
    ]),
  );
  const report = {
    suites: files.map((file, i) => ({
      file: path.basename(file),
      specs: [{ title: String(i), line: 1 }],
      suites: [],
    })),
  };
  const result = selectCaptureFiles({
    files,
    report,
    diff: { changed: [files[1]], context: {} },
    graph: new Map(),
    readSource: (file) => sources.get(file) ?? "",
    linesFor: () => new Set([3]),
  });
  expect(result.mode).toBe("affected");
  expect([...result.lines]).toEqual(["visual-sites.spec.ts › 1"]);
});

test("evidence preserves a private image copy and cannot imply image review", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visual-evidence-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const image = path.join(root, "capture.png");
  writeFileSync(image, "pixels");
  const evidence = writeCaptureEvidence({
    directory: path.join(root, "run"),
    image,
    build: { fingerprint: "tree" },
    viewport: { width: 390, height: 844 },
    contract: null,
  });
  writeFileSync(image, "a different run");
  expect(readFileSync(evidence.image, "utf8")).toBe("pixels");
  expect(evidence.review).toBe("not-reviewed");
  expect(evidence.stateEvidence).toBe("not-declared");
});

test("route contract matches dynamic segments without recording bearer tokens", () => {
  expect(matchesRoute("/ready/[token]", "/ready/secret-value")).toBe(true);
  expect(matchesRoute("/ready/[token]", "/shop/blue-mantis")).toBe(false);
  expect(matchesRoute("/shop/[shopSlug]/dive-sites/new", "/shop/demo/dive-sites/new")).toBe(true);
});

test("hashes only at boundaries while every capture uses the bound build", () => {
  let reads = 0;
  let fingerprint = "first";
  const guard = captureBuildBoundary(() => {
    reads++;
    return { fingerprint, buildId: "id" };
  });
  expect(() => guard.current()).toThrow("before capturing");
  guard.begin();
  for (let i = 0; i < 648; i++) expect(guard.current().fingerprint).toBe("first");
  expect(reads).toBe(1);
  guard.end();
  expect(reads).toBe(2);
  fingerprint = "edited-during-capture";
  expect(() => guard.end()).toThrow("changed during visual capture");
});
