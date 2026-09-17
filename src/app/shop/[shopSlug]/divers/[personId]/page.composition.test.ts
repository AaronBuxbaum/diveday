import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The file order is a server-page composition rule, not a data calculation. */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

const COMPONENTS = join(__dirname, "_components");

function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

describe("the diver record file order", () => {
  it("keeps Notes before the shared Dive support group", () => {
    const notes = positionOf("<DiverNotesSection");
    const support = positionOf("<SupportNeedsPanel");
    const activity = positionOf("<ActivitySection");

    for (const marker of [notes, support, activity]) expect(marker).toBeGreaterThan(-1);
    expect(notes).toBeLessThan(support);
    expect(support).toBeLessThan(activity);
    expect(countOf("<SupportNeedsPanel")).toBe(1);
  });

  it("keeps support outcomes routed to the support group's own anchor", () => {
    expect(SOURCE).toContain('status={noticeForForm(diverNotice, "support")}');
  });

  /**
   * **One door grammar, and one heading per group.**
   *
   * Every group in the file is a `DiverFileGroupDisclosure` whose row label is
   * its `<h2>`. The drift this refuses is the one the record shipped with: an
   * `InsetGroup` inside a group carrying a *second*, uppercase copy of the same
   * label, visible only above `sm`, so the desktop record read as two headings
   * per group with open cards between closed rows. A source sweep rather than a
   * render, because the realistic regression is a new group written by copying
   * an old one.
   */
  it("gives no file group a second heading inside its own body", () => {
    const offenders = readdirSync(COMPONENTS)
      .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
      .filter((name) => {
        const source = readFileSync(join(COMPONENTS, name), "utf8");
        if (!source.includes("<DiverFileGroupDisclosure")) return false;
        // A labelled `InsetGroup` is the second heading; an unlabelled one is
        // just the hairline shell the rows sit in, which is what they use now.
        return /<InsetGroup\b[^>]*\blabel(?:ClassName)?=/s.test(source);
      });
    expect(offenders).toEqual([]);
  });

  /** A group that opens itself above `sm` is the retired branch coming back. */
  it("keeps every group a door at every width", () => {
    const offenders = readdirSync(COMPONENTS)
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) =>
        readFileSync(join(COMPONENTS, name), "utf8").includes("desktopCollapsible"),
      );
    expect(offenders).toEqual([]);
  });
});
