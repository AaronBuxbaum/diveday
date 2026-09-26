// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorRail } from "@/components/editor/EditorRail";
import EditCourseLoading from "./shop/[shopSlug]/courses/[slug]/edit/loading";
import {
  SITE_FORM_RAIL_STUB_WIDTHS,
  SITE_FORM_SECTION_ORDER,
} from "./shop/[shopSlug]/dive-sites/_components/site-form-sections";
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
 * The width class each stub draws at, in order: the dive-site editor names one
 * per section (its labels wrap 3/3/2/2/1 at 390, which eleven uniform stubs
 * cannot), and the course editor's eight labels wrap as uniform `w-24` stubs do
 * at every swept width, so it names none.
 */
const SITE_STUB_WIDTHS = () =>
  SITE_FORM_SECTION_ORDER.map((section) => SITE_FORM_RAIL_STUB_WIDTHS[section]);
const UNIFORM_STUBS = () => Array.from({ length: courseSectionCount() }, () => "w-24");

/**
 * **An editor's skeleton draws its rail where the rail will be**
 * (docs/design/pixel-craft.md, class 11: 0px of shift on load). Each of these
 * drew a phone rail of its own — one row of 36px pills over a hairline — where
 * the loaded rail is a borderless wrap of 44px links, so the form under it
 * dropped as much as 131px at 390 when the page arrived.
 */
const SKELETONS: [
  name: string,
  Skeleton: ComponentType,
  sections: () => number,
  widths: () => readonly string[],
][] = [
  ["the new dive site", NewDiveSiteLoading, () => SITE_FORM_SECTION_ORDER.length, SITE_STUB_WIDTHS],
  [
    "a dive site's briefing",
    DiveSiteLoading,
    () => SITE_FORM_SECTION_ORDER.length,
    SITE_STUB_WIDTHS,
  ],
  ["the course editor", EditCourseLoading, courseSectionCount, UNIFORM_STUBS],
];

describe("an editor's loading skeleton", () => {
  it.each(SKELETONS)(
    "draws %s's rail in the rail's own boxes, one 44px stub per section",
    (_name, Skeleton, sections, widths) => {
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
      // Each stub at its link's width, so the phone wrap takes as many 44px
      // rows as the loaded rail does.
      expect(
        [...(list?.children ?? [])].map((stub) =>
          [...stub.classList].find((token) => /^w-/.test(token)),
        ),
      ).toEqual(widths());
    },
  );
});
