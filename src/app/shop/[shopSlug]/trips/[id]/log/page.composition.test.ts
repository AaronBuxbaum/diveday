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
