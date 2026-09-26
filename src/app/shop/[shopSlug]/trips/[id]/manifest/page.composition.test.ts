import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The manifest is a Server Component over the roll call's reads, so these read
 * its source rather than render it. They pin the page's composition — where
 * its sections sit relative to each other — never what the roll call decides
 * or shows; that is pinned beside each component.
 */
const HERE = import.meta.dirname;
const SOURCE = readFileSync(join(HERE, "page.tsx"), "utf8");

/** The source of a file under `_components/`, or under `src/components/`. */
function component(file: string): string {
  const local = join(HERE, "_components", file);
  try {
    return readFileSync(local, "utf8");
  } catch {
    return readFileSync(join(HERE, "..", "..", "..", "..", "..", "..", "components", file), "utf8");
  }
}

/** The opening `<section …>` tag around `anchor`, braces and all. */
function sectionTag(source: string, anchor: string): string {
  const at = source.indexOf(anchor);
  expect(at, `\`${anchor}\` is where this test looks`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("<section", at);
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`no end to the section around ${anchor}`);
}

/** Every section from the boat check down, in page order, with its root's anchor. */
const STACK: readonly (readonly [tag: string, file: string, anchor: string])[] = [
  ["PreDepartureCheckList", "PreDepartureCheckList.tsx", '"pre-departure-check-heading")}'],
  ["DiverRollCall", "DiverRollCall.tsx", 'id={scopedId(idPrefix, "roll-call-list")}'],
  ["CrewRollCall", "CrewRollCall.tsx", '{t("manifest.crewHeading")}'],
  [
    "TripPlanSection",
    "TripPlanSection.tsx",
    'aria-labelledby={scopedId(idPrefix, "trip-plan-heading")}',
  ],
  ["ExecutedDiveLog", "ExecutedDiveLog.tsx", '"executed-dive-heading")}'],
  ["SeenGroup", "SeenGroup.tsx", "aria-labelledby={headingId}"],
  ["BuddyTeamsPanel", "BuddyTeamsPanel.tsx", '"buddy-teams-heading")}'],
  ["OfflineManifestManager", "OfflineManifestManager.tsx", '"offline-heading")}'],
];

/**
 * **The sections from the boat check down sit at one gap** (K-189). Each
 * brought its own top margin — `mt-5`, `mt-8`, `mt-9`, `mt-8`, `mt-8`, `mt-8`,
 * `mt-9`, `mt-8` — so the page stepped 21 / 33 / 38 / 42px between sections
 * that are all the same kind of thing, and a margin on each section is the
 * pattern the section rhythm rule replaced (docs/design/forms-and-controls.md,
 * pixel-craft class 4). One `space-y-10` holds them; none carries a margin.
 */
describe("the manifest's section rhythm", () => {
  it("stacks every section from the boat check down in one space-y-10", () => {
    const open = SOURCE.indexOf('<div className="mt-5 space-y-10">');
    expect(open, "the stack's wrapper").toBeGreaterThan(-1);
    const close = SOURCE.indexOf("</OfflineManifestManager>", open);
    expect(close).toBeGreaterThan(open);
    // The wrapper closes straight after the last section.
    expect(SOURCE.slice(close).match(/^<\/OfflineManifestManager>\s*<\/div>/)).not.toBeNull();
    let from = open;
    for (const [tag] of STACK) {
      const at = SOURCE.indexOf(`<${tag}`, from);
      expect(at, `<${tag}> inside the stack, in page order`).toBeGreaterThan(from);
      expect(at).toBeLessThan(close);
      from = at;
    }
  });

  it("hangs no margin of its own on any section in it", () => {
    for (const [tag, file, anchor] of STACK) {
      expect(sectionTag(component(file), anchor), tag).not.toMatch(/\bmt-\d/);
    }
  });

  it("hangs none on the printed emergency card between them either", () => {
    const card = SOURCE.slice(
      SOURCE.indexOf('<div className="hidden print:block">'),
      SOURCE.indexOf("</div>", SOURCE.indexOf('<div className="hidden print:block">')),
    );
    expect(card).toContain("<EmergencyReferenceCard");
    expect(card).not.toMatch(/\bmt-\d/);
  });
});

/**
 * **A 44px target does not add to the 40px** (K-189). "Buddy teams" opened
 * 64px under the plan: the plan's door hung the lower half of its 44px box
 * under its words (fixed where the door is, `TripPlanSection.test.tsx`), and
 * the buddy summary padded its 28px title line to 44 above as well as below.
 * The summary hands its padding back as margin, so its box overhangs the gap
 * rather than adding to it.
 */
describe("the buddy panel's disclosure line", () => {
  it("gives its padding back as margin on every side", () => {
    const source = component("BuddyTeamsPanel.tsx");
    const summary = source.slice(
      source.indexOf("<summary"),
      source.indexOf(">", source.indexOf("<summary")) + 1,
    );
    const classes = summary.match(/className="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
    expect(classes).toEqual(expect.arrayContaining(["-m-2", "p-2", "min-h-11"]));
    for (const half of ["-mx-2", "-my-2", "px-2", "py-2"]) expect(classes).not.toContain(half);
  });
});
