import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The departure page is a Server Component over a dozen reads, so these read
 * its source rather than render it. They pin the page's composition, not the
 * behaviour of what it composes; that lives beside each component.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the departure page's packing-list anchor", () => {
  /**
   * The anchor wrapper renders on every departure so the skeleton holds the
   * position five links land on while the gear reads run. On a departure
   * nobody is booked on the packing list renders no node at all (see
   * `PrepBody.test.tsx`), and the pixel probe measured the wrapper 0px tall
   * and still holding its `mt-10` open: a 40px gap where siblings sit 20px
   * apart (trip-repeating-cadence, trip-repeating-panel). React's Suspense
   * markers are comments, which `:empty` ignores, so `empty:hidden` takes the
   * wrapper out of the flow exactly when the list says nothing, and never
   * while the skeleton or a read-failure banner is in it.
   */
  it("carries empty:hidden, and holds nothing but the Suspense boundary that may resolve to nothing", () => {
    const open = SOURCE.indexOf("<div id={PREP_SECTION_ID}");
    expect(open).toBeGreaterThan(-1);
    const tagEnd = SOURCE.indexOf(">", open);
    const tag = SOURCE.slice(open, tagEnd + 1);
    expect(tag).toMatch(/className="[^"]*\bempty:hidden\b[^"]*"/);

    const close = SOURCE.indexOf("</div>", tagEnd);
    const inside = SOURCE.slice(tagEnd + 1, close).trim();
    expect(inside.startsWith("<Suspense")).toBe(true);
    expect(inside.endsWith("</Suspense>")).toBe(true);
  });
});

describe("the cancelled departure's band", () => {
  /**
   * **A tone panel is a card in a tone** (card.tsx's `TONE_PANEL_CLASS`,
   * pixel-craft classes 3 and 12). The band hand-rolled `p-5` with no `sm:`
   * step and no bed, the geometry K-351 took off the minimum-seats band on
   * this same page: on a phone its words started 4px right of every card
   * above and below it. Only its danger border and fill are its own.
   */
  it("sits on the card's geometry, in its own danger tone", () => {
    const open = SOURCE.indexOf("{cancelled && (canConfigure");
    expect(open).toBeGreaterThan(-1);
    const section = SOURCE.indexOf("<section", open);
    const tag = SOURCE.slice(section, SOURCE.indexOf(">", section) + 1);
    expect(tag).toMatch(/\$\{TONE_PANEL_CLASS\}/);
    expect(tag).toContain("border-danger/40");
    expect(tag).not.toMatch(/\b(rounded-panel|p-5)\b/);
  });
});

describe("the departure's section rhythm", () => {
  /**
   * **Every section under the masthead sits 40px from the next** (K-262). Each
   * piece hung its own margin — the masthead `mb-5`, the cancelled band and
   * the unmet-demand card `mt-6`, the pulse links `mt-4`, the hull `mt-6`, the
   * roster `mt-5`, the packing list `mt-10`, the tail `mt-8` — so the page
   * stepped 16, 20, 24, 32 and 40px between sections of one kind. One
   * `space-y-10` holds the masthead and the page's blocks; the roster's
   * content is `display: contents`, so it carries the same stack for its own
   * children, which lie in the page's flow.
   */
  const COMPONENTS = join(__dirname, "_components");
  const body = SOURCE.slice(SOURCE.indexOf("export default async function"));

  it("holds the masthead and every block under it in one space-y-10", () => {
    expect(
      /<div className="space-y-10">\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<VoyageHeader\b/.test(body),
    ).toBe(true);
    const roster = readFileSync(join(COMPONENTS, "TripRosterContent.tsx"), "utf8");
    expect(roster).toContain('<div data-trip-guests-ready className="contents space-y-10">');
  });

  it("hangs no margin of its own on any block in it", () => {
    const blocks = [
      body.slice(
        body.indexOf("{cancelled && (canConfigure"),
        body.indexOf("<FormStatus", body.indexOf("{cancelled && (canConfigure")),
      ),
      body.slice(body.indexOf("{pulseFacts.length > 0 ? ("), body.indexOf("{pulseFacts.map")),
      body.slice(
        body.indexOf("<div id={PREP_SECTION_ID}"),
        body.indexOf("<Suspense", body.indexOf("<div id={PREP_SECTION_ID}")),
      ),
    ];
    for (const block of blocks) expect(block).not.toMatch(/(^|[\s"`])mt-(4|5|6|8|10)\b/);

    const voyage = readFileSync(join(COMPONENTS, "VoyageHeader.tsx"), "utf8");
    expect(voyage).not.toMatch(/\bmb-5\b/);
    const seats = readFileSync(join(COMPONENTS, "MinimumSeatsBand.tsx"), "utf8");
    expect(seats).not.toMatch(/(^|[\s"`])mt-6\b/);

    const roster = readFileSync(join(COMPONENTS, "TripRosterContent.tsx"), "utf8");
    const own = roster.slice(roster.indexOf('className="contents space-y-10"'));
    // The demand card, the hull's wrapper and the quiet tail.
    expect(own).not.toMatch(/className=\{`mt-6 \$\{TONE_PANEL_CLASS\}/);
    expect(own).not.toContain('<div className="mt-6">');
    expect(own).not.toContain('<div className="mt-8">');
  });

  it("keeps the skeleton on the same rhythm, so nothing jumps when the page arrives", () => {
    const skeleton = readFileSync(join(__dirname, "loading.tsx"), "utf8");
    expect(skeleton).toContain('className="animate-pulse space-y-10"');
    expect(skeleton).not.toMatch(/\b(mb-8|mt-10)\b/);
  });
});
