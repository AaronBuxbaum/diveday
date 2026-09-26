// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorRail } from "@/components/editor/EditorRail";
import EditCourseLoading from "./shop/[shopSlug]/courses/[slug]/edit/loading";
import { SITE_FORM_SECTION_ORDER } from "./shop/[shopSlug]/dive-sites/_components/site-form-sections";
import DiveSiteLoading from "./shop/[shopSlug]/dive-sites/[id]/loading";
import NewDiveSiteLoading from "./shop/[shopSlug]/dive-sites/new/loading";

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The course editor's sections are one inline list in its page, so the count
 * is read from there: a ninth section the skeleton does not know about fails
 * here rather than as a jump on every navigation into the editor.
 */
function courseSectionCount(): number {
  const page = readFileSync(
    join(HERE, "shop", "[shopSlug]", "courses", "[slug]", "edit", "page.tsx"),
    "utf8",
  );
  const list = page.match(/const sections: EditorSectionRef\[\] = \[([\s\S]*?)\];/)?.[1] ?? "";
  return [...list.matchAll(/\{\s*id:/g)].length;
}

/** The rail's two boxes as the loaded page renders them. */
function railClasses(): { nav: string; list: string } {
  const { container } = render(
    <EditorRail sections={[{ id: "a", label: "A" }]} navLabel="On this page" />,
  );
  const nav = container.querySelector("nav");
  const classes = { nav: nav?.className ?? "", list: nav?.querySelector("ul")?.className ?? "" };
  cleanup();
  return classes;
}

/**
 * **An editor's skeleton draws its rail where the rail will be**
 * (docs/design/pixel-craft.md, class 11: 0px of shift on load). Each of these
 * drew a phone rail of its own — one row of 36px pills over a hairline — where
 * the loaded rail is a borderless wrap of 44px links, so the form under it
 * dropped as much as 131px at 390 when the page arrived.
 */
const SKELETONS: [name: string, Skeleton: ComponentType, sections: () => number][] = [
  ["the new dive site", NewDiveSiteLoading, () => SITE_FORM_SECTION_ORDER.length],
  ["a dive site's briefing", DiveSiteLoading, () => SITE_FORM_SECTION_ORDER.length],
  ["the course editor", EditCourseLoading, courseSectionCount],
];

describe("an editor's loading skeleton", () => {
  it.each(SKELETONS)(
    "draws %s's rail in the rail's own boxes, one 44px stub per section",
    (_name, Skeleton, sections) => {
      const rail = railClasses();
      const { container } = render(<Skeleton />);
      const wrappers = [...container.querySelectorAll("div")].filter(
        (element) => element.className === rail.nav,
      );
      expect(wrappers).toHaveLength(1);
      const list = wrappers[0].firstElementChild;
      expect(list?.className).toBe(rail.list);
      expect(sections()).toBeGreaterThan(3);
      expect(list?.children).toHaveLength(sections());
      for (const stub of list?.children ?? []) expect(stub).toHaveClass("h-11");
    },
  );
});
