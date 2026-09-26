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

/** The skeleton's header block: `ShopPageHeaderSkeleton`'s `mb-8` box. */
function headerSkeleton(container: HTMLElement): Element | null {
  return container.querySelector(".animate-pulse > .mb-8");
}

/**
 * **The dive-site editors open on one back link, as the page does** (K-423).
 * Both skeletons drew the back link as a standalone `h-5` bar in an `mt-4`
 * wrapper, then called the header skeleton, whose default eyebrow bar draws
 * the same link a second time: every bar stood 36px below what replaced it,
 * and the header and whole form jumped up as the editor streamed in.
 */
describe("a dive-site editor's loading header", () => {
  it.each([
    ["the new dive site", NewDiveSiteLoading],
    ["a dive site's briefing", DiveSiteLoading],
  ] as const)("draws %s's back link once, as the header's own eyebrow", (_name, Skeleton) => {
    const { container } = render(<Skeleton />);
    const pulse = container.querySelector(".animate-pulse");
    const header = headerSkeleton(container);
    expect(header).not.toBeNull();
    expect(pulse?.firstElementChild).toBe(header);
    expect(container.querySelector(".h-5.w-36")).toBeNull();
    // Above the title bar, the eyebrow and nothing else.
    const bars = [...(pulse?.querySelectorAll("div") ?? [])];
    const title = bars.findIndex((bar) => bar.classList.contains("h-11"));
    expect(bars.slice(0, title).filter((bar) => /\bh-\d/.test(bar.className))).toEqual([
      header?.firstElementChild,
    ]);
    expect(header?.firstElementChild).toHaveClass("h-4");
  });
});

/**
 * **A dive site's skeleton holds the "Upcoming dives here" card's place**
 * (K-416). The page draws that card between its header and the editor for a
 * site with departures — its title, then a hairline list of rows, each a
 * departure and, for the soonest, its tide line: 68px a row. The skeleton drew
 * nothing there, so the whole form dropped by the card when it arrived.
 */
describe("a dive site's loading skeleton", () => {
  it("draws the upcoming-dives card, three rows deep, above the editor", () => {
    const { container } = render(<DiveSiteLoading />);
    const pulse = container.querySelector(".animate-pulse");
    const children = [...(pulse?.children ?? [])];
    const grid = children.findIndex((child) => child.classList.contains("lg:grid"));
    const card = children.slice(0, grid).find((child) => child.classList.contains("rounded-panel"));
    expect(card).toBeDefined();
    expect(card?.querySelectorAll(".h-17")).toHaveLength(3);
  });
});

/**
 * **The course editor's skeleton draws the "Live at /s/…" line** (K-417). The
 * loaded header carries it as `meta`, 12px under the title and one 20px line
 * tall, and the skeleton drew no meta at all: everything below the title
 * dropped 32px on load.
 */
describe("the course editor's loading header", () => {
  it("draws the one-line meta the loaded header carries", () => {
    const { container } = render(<EditCourseLoading />);
    const meta = headerSkeleton(container)?.querySelector(":scope > .mt-3");
    expect(meta).not.toBeNull();
    expect(meta?.firstElementChild).toHaveClass("h-5");
  });
});
