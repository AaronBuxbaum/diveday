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

/**
 * Every opening `<tag …>` in `source`, props and all. A `>` inside a `{…}`
 * expression (an arrow, a comparison) does not end the tag; the first one at
 * brace depth zero does.
 */
function openingTags(source: string, tag: string): string[] {
  const tags: string[] = [];
  const pattern = new RegExp(`<${tag}\\b`, "g");
  for (const match of source.matchAll(pattern)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
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

  /**
   * **One rhythm between the record's sections, and the page owns it.**
   *
   * Each section used to hang its own margin: the story `mt-10`, the
   * conversation `mt-8`, certifications `mt-10`, the next four `mt-8`, and
   * the shelf nothing at all. The pixel probe measured the stack at
   * 32/40/32/32/0/32/32/32px, with the shelf's row sitting flush against the
   * gear row's hairline. forms-and-controls.md's rule is `space-y-10` on the
   * wrapper, never `mt-*` on a section, and this holds both halves.
   */
  it("stacks the story and the file on one space-y-10, with no section carrying its own margin", () => {
    const stack = SOURCE.lastIndexOf("space-y-10", positionOf("<DiverStory"));
    expect(stack).toBeGreaterThan(-1);
    // The wrapper opens before the story and nothing closes it before the file
    // ends: the only `</div>` between it and the last group is its own.
    const between = SOURCE.slice(stack, positionOf("<ActivitySection"));
    expect(between).not.toContain("</div>");

    // The sections in the stack, read off the page, and each one's own root.
    const sections = [...`${between}<ActivitySection`.matchAll(/<([A-Z]\w+)/g)].map(
      ([, name]) => name,
    );
    expect(sections).toContain("CertificationsGroup");
    const offenders = sections.filter((name) => {
      const source = readFileSync(join(COMPONENTS, `${name}.tsx`), "utf8");
      return [
        ...openingTags(source, "DiverFileGroupDisclosure"),
        ...openingTags(source, "section"),
      ].some((tag) => /\bclassName="[^"]*\bmt-/.test(tag));
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
