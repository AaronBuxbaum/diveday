import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The departure page is a Server Component over a dozen reads, so these read
 * its source rather than render it. They pin the page's composition, not the
 * behaviour of what it composes; that lives beside each component.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the departure's tabs", () => {
  /**
   * ADR 20261001-logbook, decision 3, as amended 2026-10-05: the departure is
   * four tabs under a stage stepper. This page is two of them, Divers and Details, chosen by `?view=`
   * or by an About form's own notice, so a save on Details lands back on it.
   */
  it("draws the tabs right under the masthead, on every departure", () => {
    const body = SOURCE.slice(SOURCE.indexOf("export default async function"));
    const masthead = body.indexOf("<TripPageHeader");
    const tabs = body.indexOf("<TripTabs");
    expect(tabs).toBeGreaterThan(masthead);
    // Never behind `cancelled`: the Boat tab is a blown-out departure's way to
    // its roll call (dive-domain review 20260920).
    const opener = body.slice(body.lastIndexOf("\n", tabs - 1), tabs);
    expect(opener.trim()).toBe("");
    expect(body.slice(body.lastIndexOf("*/}", tabs), tabs)).not.toMatch(/\?|&&/);
  });

  it("shows Details or Divers, never both, and packs nothing here", () => {
    expect(SOURCE).toMatch(/\{showDetails \? \(\s*<>\s*<TripAboutSection/);
    expect(SOURCE).not.toContain('PREP_SECTION_ID}"');
    expect(SOURCE).not.toContain("<TripPrepSection");
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
  const PULSE = readFileSync(join(COMPONENTS, "PulseFacts.tsx"), "utf8");

  it("holds the masthead and every block under it in one space-y-10", () => {
    expect(
      /<div className="space-y-10">\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<TripPageHeader\b/.test(body),
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
      // The pulse facts are their own component now; the page only places it.
      body.slice(body.indexOf("<PulseFacts"), body.indexOf("/>", body.indexOf("<PulseFacts"))),
      // Its outer row; the fold's own inner spacing is inside the block.
      PULSE.match(/export function PulseFacts[\s\S]*?return \(\s*(<div [^>]*>)/)?.[1] ?? "",
    ];
    expect(body.indexOf("<PulseFacts")).toBeGreaterThan(-1);
    for (const block of blocks) {
      expect(block.length).toBeGreaterThan(0);
      expect(block).not.toMatch(/(^|[\s"`])mt-(4|5|6|8|10)\b/);
    }

    expect(body).toMatch(/<TripPageHeader\s+className=""/);
    const seats = readFileSync(join(COMPONENTS, "MinimumSeatsBand.tsx"), "utf8");
    expect(seats).not.toMatch(/(^|[\s"`])mt-6\b/);

    const roster = readFileSync(join(COMPONENTS, "TripRosterContent.tsx"), "utf8");
    const own = roster.slice(roster.indexOf('className="contents space-y-10"'));
    // The demand card, the hull's wrapper and the quiet tail.
    expect(own).not.toMatch(/className=\{`mt-6 \$\{TONE_PANEL_CLASS\}/);
    expect(own).not.toContain('<div className="mt-6">');
    expect(own).not.toContain('<div className="mt-8">');
  });

  it("sets the pulse facts' words, not their 44px boxes, 40px from their neighbours", () => {
    // Each fact is a 44px link round a 20px line, so its words sat 12px inside
    // each 40px gap: 52px from the About card and 52px above the roster. Each
    // link hands the unseen 12px back as `-my-3` and the row is its words'
    // height; `gap-y-7` keeps a wrapped line's box 4px clear of the one above,
    // as `gap-y-1` did. Not `-my-3` on the row: the stack's end margin is
    // `:where()`, so the row's own would replace it and pull the roster up.
    const pulse = PULSE.slice(PULSE.indexOf("export function PulseFacts"));
    // The row that holds every fact, open or folded.
    const row = pulse.match(/return \(\s*<div className="([^"]*)">/)?.[1] ?? "";
    expect(row.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-wrap", "gap-y-7"]));
    expect(row).not.toMatch(/(^|\s)-?m[ty]?-/);
    const link = PULSE.match(/const FACT_LINK_CLASS =\s*"([^"]*)"/)?.[1] ?? "";
    expect(link.split(/\s+/)).toEqual(
      expect.arrayContaining(["-my-3", "inline-flex", "min-h-11", "items-center", "text-sm"]),
    );
    // And the page places it straight in the stack, with nothing round it.
    expect(body).toMatch(/\n\s*<PulseFacts\n/);
  });

  it("keeps the skeleton on the same rhythm, so nothing jumps when the page arrives", () => {
    const skeleton = readFileSync(join(__dirname, "loading.tsx"), "utf8");
    expect(skeleton).toContain('className="animate-pulse space-y-10"');
    expect(skeleton).not.toMatch(/\b(mb-8|mt-10)\b/);
  });
});
