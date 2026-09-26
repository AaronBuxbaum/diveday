// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge, type BadgeSize, type BadgeTone } from "./badge";

/**
 * **One pill, one box, whatever it says.**
 *
 * The neutral tone drew its edge with `border border-border` and every other
 * tone was fill-only, so "Not here" stood 30px tall beside a 28px "Blocked" on
 * the same roll-call line, 26px against 24px at `sm`, and it was the one pill
 * that kept its outline on paper (pixel probe, `manifest-not-here`,
 * `schedule`; docs/design/pixel-craft.md's own class-12 example). The neutral
 * edge is an inset ring now, which paints the same line and takes no room.
 *
 * jsdom has no layout, so this pins the classes that decide the box: no tone
 * may add a border, and the neutral one keeps its edge as a ring.
 */
afterEach(cleanup);

const TONES: readonly BadgeTone[] = ["primary", "success", "warning", "danger", "neutral"];
const SIZES: readonly BadgeSize[] = ["sm", "md", "lg"];

const BORDER_WIDTH = /^(?:[a-z-]+:)*border(?:-[xytblrse])?(?:-\d+)?$/;

function pill(tone: BadgeTone, size: BadgeSize) {
  render(
    <Badge tone={tone} size={size}>
      {`${tone} ${size}`}
    </Badge>,
  );
  const element = screen.getByText(`${tone} ${size}`);
  cleanup();
  return element;
}

describe("Badge geometry", () => {
  it.each(TONES.flatMap((tone) => SIZES.map((size) => [tone, size] as const)))(
    "%s at %s adds no border width to the box",
    (tone, size) => {
      const classes = pill(tone, size).className.split(/\s+/);
      expect(classes.filter((token) => BORDER_WIDTH.test(token))).toEqual([]);
    },
  );

  it("draws the neutral edge as an inset ring, which takes no room", () => {
    const classes = pill("neutral", "md").className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["ring-1", "ring-inset", "ring-border"]));
  });

  it.each(SIZES)("gives every tone the same padding at %s", (size) => {
    const padding = (tone: BadgeTone) =>
      pill(tone, size)
        .className.split(/\s+/)
        .filter((token) => /^p[xy]?-/.test(token))
        .sort();
    const neutral = padding("neutral");
    for (const tone of TONES) expect(padding(tone), tone).toEqual(neutral);
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");

/** The three tones that carry a drawn mark by default. */
const MARKED: BadgeTone[] = ["success", "warning", "danger"];

/**
 * **The word sets the pill's baseline, never its mark** — pixel-craft class 1,
 * the mechanism FactSource's chip had (K-96). An `inline-flex` box with no
 * baseline-aligned item takes its baseline from its first item, and a toned
 * pill's first item is its 16px StatusMark, an `<svg>` whose synthesized
 * baseline is its bottom edge: 22px down a 28px pill, where the word's is 19.
 * Beside a card title in SectionCard's `items-baseline` header, "Delivery
 * proven" would have sat 3px above "Backups are set up" (settings-export at
 * 1280). Aligning the items on their baselines hands the pill the word's; the
 * mark centres itself on the word's line as it did before.
 */
describe("Badge", () => {
  it.each(MARKED.flatMap((tone) => SIZES.map((size) => [tone, size] as const)))(
    "hands a %s %s pill's row the word's baseline, with its mark centred",
    (tone, size) => {
      render(
        <Badge tone={tone} size={size}>
          Delivery proven
        </Badge>,
      );
      const pill = screen.getByText("Delivery proven");
      expect(pill).toHaveClass("inline-flex", "items-baseline");
      expect(pill).not.toHaveClass("items-center");
      const mark = pill.querySelector("svg");
      expect(mark).not.toBeNull();
      expect(mark).toHaveClass("self-center");
      expect(mark).not.toHaveClass("items-center");
    },
  );

  it("draws no mark on a label tone, or when the caller turns it off", () => {
    const { container: label } = render(<Badge tone="primary">3 open</Badge>);
    expect(label.querySelector("svg")).toBeNull();
    const { container: count } = render(
      <Badge tone="danger" toneMark={false}>
        19
      </Badge>,
    );
    expect(count.querySelector("svg")).toBeNull();
    expect(count.firstElementChild).toHaveClass("items-baseline");
  });
});

/**
 * The tree half: a drawn mark a caller passes into a pill (the day spine's
 * boat in its stage chip) is an item the pill now aligns on its baseline, and
 * a mark's baseline is its bottom edge. Left alone it would stand 2-3px above
 * the word and push the pill taller, so it centres itself as StatusMark does.
 */
describe("a drawn mark inside a Badge", () => {
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
    });
  }

  const MARK_TAG = /<(svg|SiteMark|StatusMark|[A-Z]\w*Icon)\b[^>]*>/g;

  it("centres itself", () => {
    const offenders: string[] = [];
    let marks = 0;
    for (const file of files(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const badge of text.matchAll(/<Badge\b[^>]*?>([\s\S]*?)<\/Badge>/g)) {
        for (const mark of (badge[1] ?? "").matchAll(MARK_TAG)) {
          marks++;
          if (/\bself-center\b/.test(mark[0])) continue;
          const at = (badge.index ?? 0) + badge[0].indexOf(mark[0]);
          const line = text.slice(0, at).split("\n").length;
          offenders.push(`${relative(SRC_DIR, file).split(/[\\/]/).join("/")}:${line}`);
        }
      }
    }
    // The sweep sees the one mark a caller passes today, so it cannot pass by
    // matching nothing.
    expect(marks).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
