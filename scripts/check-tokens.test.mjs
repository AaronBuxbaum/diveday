import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findTokenViolations, scanTree } from "./check-tokens.mjs";

const texts = (source) => findTokenViolations(source).map((hit) => hit.text);

describe("hex colors", () => {
  it("catches every valid hex length, in styles, attributes, and arbitrary values", () => {
    expect(texts('style={{ color: "#333" }}')).toEqual(["raw hex #333"]);
    expect(texts('<stop stopColor="#22d3eecc" />')).toEqual(["raw hex #22d3eecc"]);
    expect(texts('const css = "background:#0e7490;color:#fff";')).toEqual([
      "raw hex #0e7490",
      "raw hex #fff",
    ]);
    expect(texts('<div className="bg-[#0ea5e9]" />')).toEqual(["raw hex #0ea5e9"]);
  });

  it("never flags fragment hrefs, even hex-lookalike ones — the false-positive trap that exists in the tree", () => {
    // `#add-diver` starts with three hex digits; the real RosterSection.tsx
    // links to it. The identifier continuation must stop the match.
    expect(texts('<a href="#add-diver">Add</a>')).toEqual([]);
    expect(texts('href={openSeats <= 0 ? "#waitlist" : "#add-diver"}')).toEqual([]);
    expect(texts('<a href="#facade_intro">x</a>')).toEqual([]);
  });

  it("never flags hex inside comments — documented values are prose, not styling", () => {
    expect(texts("// #5b6f77 is the light-mode `--muted` token value\nconst x = 1;")).toEqual([]);
    expect(texts("/* was #0e7490 */ const y = 2;")).toEqual([]);
  });

  it("never flags an issue or PR citation, in a string as well as a comment", () => {
    // The regression: a comment citing an issue was always safe, because
    // comments are stripped before the scan. A *test title* carrying the same
    // citation is a string literal, and `#722` is three valid hex digits — so
    // `describe("ScheduleBuilder wind line (issue #722)")` turned main red on a
    // file with no colour in it.
    expect(texts('describe("ScheduleBuilder wind line (issue #722)", () => {});')).toEqual([]);
    expect(texts('it("closes issue #1010 and PR #949", () => {});')).toEqual([]);
    expect(texts('const note = "see issues #700, and pull request #808";')).toEqual([]);
  });

  it("still flags an all-digit hex that nothing cites — it is a colour", () => {
    // The rule is "preceded by the word that makes it a citation", not "all
    // digits". Black and near-black are the hex a component is most likely to
    // reach for, and they stay covered.
    expect(texts('style={{ color: "#000" }}')).toEqual(["raw hex #000"]);
    expect(texts('const shadow = "#111111";')).toEqual(["raw hex #111111"]);
    // A bare number with no citing word in front of it is still a colour, and
    // that includes a citation written without one: `"fixes #1010"` is flagged
    // and `"fixes issue #1010"` is not. Deliberate — the alternative is
    // forgiving every all-digit hex, which would blind the check to `#000` and
    // `#111111`, the two a component is most likely to reach for.
    expect(texts('const x = "#722";')).toEqual(["raw hex #722"]);
    expect(texts('it("fixes #1010", () => {});')).toEqual(["raw hex #1010"]);
  });

  it("ignores invalid hex lengths and long hashes", () => {
    expect(texts('const sha = "#deadbeefcafe";')).toEqual([]);
    expect(texts('const five = "#abcde";')).toEqual([]);
  });
});

describe("palette-scale classes", () => {
  it("catches the plain, variant-prefixed, opacity-suffixed, and gradient forms", () => {
    expect(texts('className="bg-cyan-600"')).toEqual(["palette-scale class bg-cyan-600"]);
    expect(texts('className="dark:text-red-500/80"')).toEqual(["palette-scale class text-red-500"]);
    expect(texts('className="from-slate-50 to-sky-950"')).toEqual([
      "palette-scale class from-slate-50",
      "palette-scale class to-sky-950",
    ]);
  });

  it("never flags semantic-token utilities or non-color scales", () => {
    expect(texts('className="bg-surface text-muted border-border shadow-sm"')).toEqual([]);
    expect(texts('className="text-2xl ring-2 outline-none accent-primary"')).toEqual([]);
    // A palette word without a scale is a token name, not a palette class.
    expect(texts('className="bg-coral text-ink"')).toEqual([]);
    // Mid-identifier fragments never match.
    expect(texts('const some_bg_red_500 = "not-bg-red-500-really";')).toEqual([]);
  });
});

describe("the tree walk", () => {
  it("skips Next metadata-file conventions and .d.ts, and reports everything else per file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "check-tokens-"));
    const files = {
      "src/app/opengraph-image.tsx": 'const bg = "#071720";\n', // Satori bitmap — exempt
      "src/app/manifest.ts": 'export default () => ({ theme_color: "#0e7490" });\n', // PWA JSON — exempt
      "src/app/page.tsx": '<div className="bg-cyan-600" style={{ color: "#333" }} />;\n',
      "src/components/env.d.ts": 'declare const c: "#fff";\n',
      // The metadata-name exemption only applies under src/app — a shared
      // component can't opt out by taking one of the convention names.
      "src/components/icon.tsx": 'const c = "#0e7490";\n',
      // The shared chrome the four cards render through: exempt by exact path,
      // for the same reason as the names above (FU-20260812).
      "src/app/_og/card.tsx": 'export const OG_COLORS = { base: "#071720" };\n',
      // The allowlist is a path, not a folder — a neighbour in the same
      // directory cannot inherit the exemption.
      "src/app/_og/other.tsx": 'const c = "#071720";\n',
    };
    for (const [relative, contents] of Object.entries(files)) {
      await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
      await writeFile(path.join(root, relative), contents);
    }
    const details = await scanTree(root);
    expect([...details.keys()].sort()).toEqual([
      "src/app/_og/other.tsx",
      "src/app/page.tsx",
      "src/components/icon.tsx",
    ]);
    expect(details.get("src/app/page.tsx")).toHaveLength(2);
    expect(details.get("src/components/icon.tsx")).toHaveLength(1);
  });
});
