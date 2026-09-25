import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SEGMENT_CORNER, SEGMENT_RAISED, segmentClass, segmentedTrackClass } from "./segmented";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");
const CSS = readFileSync(join(SRC_DIR, "app", "globals.css"), "utf8");

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

/**
 * **A segment's corner is the track's corner less the track's inset**
 * (docs/design/pixel-craft.md, class 6). The pixel probe measured every
 * segmented track in the suite with a 12px segment 5px inside a 12px corner,
 * where a concentric curve is 7px: 73 `nested-corners` flags on the sliding
 * pill and 57 `fill-corners` flags on the options' hover fill, across 42
 * captures. A 12px curve that close to a 12px one does not run parallel to it
 * — the sunken band between them is 5px along the sides and fattens toward
 * the corner, so the pill reads as a separate rounded tile dropped on the
 * track rather than a part of it.
 *
 * The first test pins the *derivation*: the corner is spelled from the same
 * tokens the track's border and padding are, so a track that changes its
 * padding fails here until its segments are re-derived.
 *
 * The second pins the *number*, 7px, and that is deliberate. The docs quote
 * it (pixel-craft.md's numbers table, forms-and-controls.md's rungs), and a
 * token change that re-derives correctly still leaves those saying 7. So a
 * change to `--radius-inset` fails here even when the corner is right. The
 * fix is to update the docs and this number together, not to drop the pin.
 */
describe("the segment's corner", () => {
  it("subtracts exactly the track's own border and padding from the track's radius", () => {
    const track = tokens(segmentedTrackClass);
    expect(track, "the track wears the inset rung").toContain("rounded-inset");
    // One hairline and one step of padding: that is the inset the corner
    // subtracts. A second step (`p-1.5`, `p-2`) or a thicker border changes
    // the geometry, and this list is where that shows up first.
    expect(track.filter((token) => /^border(-\d+)?$/.test(token))).toEqual(["border"]);
    expect(track.filter((token) => /^p-/.test(token))).toEqual(["p-1"]);
    expect(SEGMENT_CORNER).toBe("rounded-[calc(var(--radius-inset)-var(--spacing)-1px)]");
  });

  it("comes to 7px on today's tokens — 12, less 1px of border and 4px of padding", () => {
    const inset = CSS.match(/--radius-inset:\s*([\d.]+)rem;/);
    expect(inset, "globals.css declares --radius-inset in rem").not.toBeNull();
    // `p-1` is one `--spacing`, and the app leaves Tailwind's 0.25rem alone.
    expect(CSS).not.toMatch(/--spacing:/);
    const px = Number(inset?.[1]) * 16 - 0.25 * 16 - 1;
    expect(px).toBe(7);
  });

  it("is on every segment, selected or not, and never the control rung", () => {
    for (const selected of [true, false]) {
      for (const raised of [true, false]) {
        const classes = tokens(segmentClass({ selected, raised }));
        expect(classes, `selected=${selected} raised=${raised}`).toContain(SEGMENT_CORNER);
        expect(classes, `selected=${selected} raised=${raised}`).not.toContain("rounded-lg");
      }
    }
  });
});

describe("segmentClass", () => {
  it("raises the selected segment with the one pill look, in the primary ink", () => {
    const classes = tokens(segmentClass({ selected: true }));
    expect(classes).toContain("text-primary");
    for (const token of tokens(SEGMENT_RAISED)) expect(classes).toContain(token);
  });

  it("leaves the fill to a separate pill when asked, keeping the selected ink", () => {
    // `SegmentedControl` draws the fill on a sliding element once it has
    // measured; the option underneath keeps its ink and drops its own fill.
    const classes = tokens(segmentClass({ selected: true, raised: false }));
    expect(classes).toContain("text-primary");
    expect(classes).not.toContain("shadow-sm");
    expect(classes).not.toContain("bg-surface");
  });

  it("gives an unselected segment a hover fill in the same corner, and no pill", () => {
    const classes = tokens(segmentClass({ selected: false }));
    expect(classes).toEqual(expect.arrayContaining(["text-muted", "hover:bg-surface"]));
    expect(classes).not.toContain("shadow-sm");
  });

  it("never changes weight on selection, so choosing reflows nothing", () => {
    for (const selected of [true, false]) {
      expect(tokens(segmentClass({ selected }))).toContain("font-semibold");
    }
  });
});

/**
 * **The track is spelled once.** The party-size picker and the embed page's
 * look toggle each hand-rolled `rounded-inset … bg-surface-sunken p-1` with
 * `rounded-lg` segments, which is how all three tracks came to carry the same
 * mis-nested corner; the fix had to be made three times because the shape had
 * been written three times. A radio group cannot be `SegmentedControl` (that is
 * a `<nav>` of links, and a radio's value has to reach `FormData`), so it takes
 * the recipe instead — and this is what keeps a fourth copy out.
 */
describe("no call site spells the segmented track", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  /**
   * Code only: block comments (JSX's `{/* … *\/}` included) and line comments
   * are dropped first, so prose that names the track is not an offender. Not
   * a string-literal match — backticks in a doc comment pair up with the wrong
   * ones and swallow the class list after them, which is how a first draft of
   * this scan found one of the three copies and passed over the other two.
   */
  const code = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("finds the track's signature only in the recipe", () => {
    const recipe = join(HERE, "segmented.ts");
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== recipe)
      .filter((file) =>
        // One line holds a class list's tokens, even where a template string
        // wraps around an interpolation.
        code(readFileSync(file, "utf8"))
          .split("\n")
          .some(
            (line) =>
              /\brounded-inset\b/.test(line) &&
              /\bbg-surface-sunken\b/.test(line) &&
              /(?:^|[\s"'`])p-1(?=[\s"'`]|$)/.test(line),
          ),
      )
      .map((file) => relative(SRC_DIR, file).split(/[\\/]/).join("/"));
    // Listed, not counted — a failure names the file to open.
    expect(offenders).toEqual([]);
  });
});
