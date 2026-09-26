import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The departure log is a Server Component over the incident export, behind
 * the owner gate, so these read its source rather than render it. They pin
 * the page's layout — what a printout and a phone make of it — never what it
 * records; the document's facts are pinned in `src/lib/incident-export.test.ts`
 * and `e2e/departure-log.spec.ts`.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

/** The source of the `<section>` its heading id labels, up to its close. */
function section(headingId: string): string {
  const label = SOURCE.indexOf(`aria-labelledby="${headingId}"`);
  expect(label, `the section labelled ${headingId} is where this test looks`).toBeGreaterThan(-1);
  const start = SOURCE.lastIndexOf("<section", label);
  return SOURCE.slice(start, SOURCE.indexOf("</section>", start));
}

describe("the log's section rhythm", () => {
  /**
   * The first section hung `mt-7` under the header, the next six `mt-8`, and
   * the footer `mt-10`: three steps where the page has one (ink to ink at
   * 1280, 36 / 41 / 43px — K-503, DEPARTURE-4-30). Section rhythm is one
   * `space-y-10` on the wrapper, never a margin on each section
   * (docs/design/forms-and-controls.md).
   */
  it("stacks the header, every section and the footer in one space-y-10", () => {
    const body = SOURCE.slice(SOURCE.indexOf("export default async function"));
    expect(
      /return \(\s*<div className="space-y-10">\s*<header\b/.test(body),
      "the page's root wrapper is one space-y-10 around the header and sections",
    ).toBe(true);
  });

  it("hangs no margin of its own on any section or on the footer", () => {
    const tags = SOURCE.match(/<(?:section|footer)\b[^>]*>/g) ?? [];
    expect(tags.length, "seven sections and the footer").toBe(8);
    for (const tag of tags) expect(tag).not.toMatch(/\bmt-/);
  });

  it("keeps the skeleton on the same rhythm, so nothing jumps when the log arrives", () => {
    const skeleton = readFileSync(join(__dirname, "loading.tsx"), "utf8");
    expect(skeleton).toContain('className="animate-pulse space-y-10"');
    expect(skeleton).not.toMatch(/\bmt-[78]\b/);
  });
});

describe("the emergency contact cell", () => {
  /**
   * "Asha Sharma (sister) · +1-305-555-0231" was breakable on both sides of
   * the dot, so a narrow cell led its second line with "·" (K-552,
   * DEPARTURE-4-48). A no-break space glues the dot to the name; the phone
   * after it keeps its own `whitespace-nowrap` (issue #1035).
   */
  it("keeps the dot with the name it follows", () => {
    const at = SOURCE.indexOf("{diver.emergencyContactName}");
    expect(at, "the contact cell is where this test looks").toBeGreaterThan(-1);
    const join = SOURCE.slice(at + "{diver.emergencyContactName}".length).trimStart();
    expect(join.startsWith('{"\\u00a0"}·{" "}')).toBe(true);
  });
});

describe("the pre-departure check", () => {
  /**
   * Two columns — the item and who checked it when — under a `36rem` scroll
   * floor: 576px in a phone's 356px shell, so the Status column began at
   * x ≈ 321 and 220px of it sat off screen behind a sideways scroll (K-279,
   * DEPARTURE-4-22). Two columns share a phone's width and wrap; the floor is
   * for the roll-call tables, whose column count grows with the dives.
   */
  it("lets its two columns share a phone's width rather than scroll", () => {
    const tables = section("incident-checklist-heading").match(/<Table\b[^>]*>/g) ?? [];
    expect(tables).toHaveLength(1);
    expect(tables[0]).not.toContain("minWidth");
  });
});

describe("the roll-call tables' columns", () => {
  /**
   * Under `table-layout: fixed` a table that names no widths splits into equal
   * columns, so the roster's six were 125px each on paper and 149px on screen:
   * a checkpoint's "Awaiting roll call" had as much room as the buddy cell
   * beside it, which ran four and five lines (K-104, DEPARTURE-8-20). The
   * checkpoint columns are pinned at 8rem and the diver, contact and buddy
   * columns share the rest; `Table` releases the pin in print, where the
   * paper's width is all there is.
   */
  for (const id of ["incident-roster-heading", "incident-crew-heading"]) {
    it(`pins each checkpoint column at 8rem (${id})`, () => {
      const headers = section(id).match(/<Th\b[^>]*>\s*\{checkpointText\(checkpoint\)\}/g) ?? [];
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('width="8rem"');
    });
  }
});
