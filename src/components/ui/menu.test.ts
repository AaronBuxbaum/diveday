import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MENU_PANEL, MENU_TICK_GUTTER, type MenuRowTone, menuRowClass } from "./menu";
import { SEGMENT_CORNER, segmentedTrackClass } from "./segmented";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);
const TONES: MenuRowTone[] = ["quiet", "current", "armed"];

/**
 * **A menu row's corner is the panel's corner less the panel's inset**
 * (docs/design/pixel-craft.md, class 6). The rows reuse `SEGMENT_CORNER`
 * rather than a corner of their own, so the panel has to sit its rows exactly
 * as far in as a segmented track does. If either changes its border or
 * padding, this fails before the corner stops nesting.
 */
describe("the menu panel's inset", () => {
  it("is the segmented track's: the inset rung, one hairline, one p-1 step", () => {
    const panel = tokens(MENU_PANEL);
    const track = tokens(segmentedTrackClass);
    for (const list of [panel, track]) {
      expect(list).toContain("rounded-inset");
      expect(list.filter((token) => /^border(-\d+)?$/.test(token))).toEqual(["border"]);
      expect(list.filter((token) => /^p[xy]?-/.test(token))).toEqual(["p-1"]);
    }
  });
});

describe("menuRowClass", () => {
  it("gives every tone the derived corner, never the control rung", () => {
    for (const tone of TONES) {
      expect(tokens(menuRowClass(tone)), tone).toContain(SEGMENT_CORNER);
      expect(tokens(menuRowClass(tone)), tone).not.toContain("rounded-lg");
    }
  });

  it("starts every tone's words on the tick gutter, with no other horizontal padding", () => {
    for (const tone of TONES) {
      const classes = tokens(menuRowClass(tone));
      for (const token of tokens(MENU_TICK_GUTTER)) expect(classes, tone).toContain(token);
      const inline = classes.filter((token) => /^(p|px|pl|pr|ps|pe)-/.test(token));
      expect(inline.sort(), tone).toEqual(tokens(MENU_TICK_GUTTER).sort());
    }
  });

  it("warns on an armed row with an inset ring and no border, so arming moves no words", () => {
    const armed = tokens(menuRowClass("armed"));
    expect(armed).toEqual(expect.arrayContaining(["ring-1", "ring-inset", "text-danger"]));
    expect(armed.filter((token) => /^border/.test(token))).toEqual([]);
  });
});

/**
 * **The panel is spelled once.** The identity menu, the When menu and the
 * language picker each spelled `rounded-inset … p-2 shadow-lg` by hand, which
 * is how all three came to carry the same mis-nested corner. This scan keeps a
 * fourth copy out. Comments are dropped first, so prose that names the panel
 * is not an offender.
 */
describe("no call site spells a menu panel", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("finds the panel's signature only in the recipe", () => {
    const recipe = join(HERE, "menu.ts");
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== recipe)
      .filter((file) =>
        code(readFileSync(file, "utf8"))
          .split("\n")
          .some(
            (line) =>
              /\brounded-inset\b/.test(line) &&
              /\bshadow-lg\b/.test(line) &&
              /(?:^|[\s"'`])p-[12](?=[\s"'`]|$)/.test(line),
          ),
      )
      .map((file) => relative(SRC_DIR, file).split(/[\\/]/).join("/"));
    // Listed, not counted: a failure names the file to open.
    expect(offenders).toEqual([]);
  });
});
