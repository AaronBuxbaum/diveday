import { describe, expect, it } from "vitest";

import {
  findFakeLinkHrefs,
  findScrollMountViolations,
  mountsPreserveFormScroll,
} from "./check-scroll-preservation.mjs";

/**
 * Both halves of this rule need to see the shape and leave its near-misses
 * alone: invariant 1 must tell a real JSX mount from a bare import or the
 * component's own internal `<PreserveFormScrollEffects />`, and invariant 2
 * must tell a real fake-link href from prose quoting the pattern (this
 * repo's own regression tests for the incident that motivated the rule do
 * exactly that, in comments).
 */

describe("PreserveFormScroll mount", () => {
  it("recognizes a JSX mount, not the import or the sibling effects component", () => {
    expect(
      mountsPreserveFormScroll(
        'import { PreserveFormScroll } from "@/components/PreserveFormScroll";',
      ),
    ).toBe(false);
    expect(mountsPreserveFormScroll("<PreserveFormScrollEffects />")).toBe(false);
    expect(mountsPreserveFormScroll("<PreserveFormScroll />")).toBe(true);
    expect(
      mountsPreserveFormScroll("<PreserveFormScroll>\n  <Child />\n</PreserveFormScroll>"),
    ).toBe(true);
  });

  it("passes when only the root layout mounts it", () => {
    const layoutFiles = [
      { file: "src/app/layout.tsx", contents: "<body>\n  <PreserveFormScroll />\n</body>" },
      { file: "src/app/shop/[shopSlug]/layout.tsx", contents: "<body>{children}</body>" },
      { file: "src/app/s/[shopSlug]/layout.tsx", contents: "<body>{children}</body>" },
    ];
    expect(findScrollMountViolations(layoutFiles)).toEqual([]);
  });

  it("fails when a second layout mounts it too — the regression this check exists for", () => {
    const layoutFiles = [
      { file: "src/app/layout.tsx", contents: "<body>\n  <PreserveFormScroll />\n</body>" },
      {
        file: "src/app/ready/[token]/layout.tsx",
        contents: "<body>\n  <PreserveFormScroll />\n  {children}\n</body>",
      },
    ];
    const violations = findScrollMountViolations(layoutFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/app/ready/[token]/layout.tsx");
    expect(violations[0]).toContain("renders <PreserveFormScroll />");
  });

  it("fails when the root layout is missing the mount", () => {
    const layoutFiles = [
      { file: "src/app/layout.tsx", contents: "<body>{children}</body>" },
      { file: "src/app/shop/[shopSlug]/layout.tsx", contents: "<body>{children}</body>" },
    ];
    const violations = findScrollMountViolations(layoutFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/app/layout.tsx");
    expect(violations[0]).toContain("does not render <PreserveFormScroll />");
  });

  it("fails when the root layout is entirely absent from the given set", () => {
    const layoutFiles = [
      { file: "src/app/shop/[shopSlug]/layout.tsx", contents: "<body>{children}</body>" },
    ];
    const violations = findScrollMountViolations(layoutFiles);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/app/layout.tsx");
  });
});

describe("fake-link hrefs", () => {
  it("catches a bare hash fragment in every quoting form", () => {
    expect(findFakeLinkHrefs('<a href="#">Add</a>').map((v) => v.rule)).toEqual(["hash-fragment"]);
    expect(findFakeLinkHrefs("<a href='#'>Add</a>").map((v) => v.rule)).toEqual(["hash-fragment"]);
    expect(findFakeLinkHrefs('<a href={"#"}>Add</a>').map((v) => v.rule)).toEqual([
      "hash-fragment",
    ]);
    expect(findFakeLinkHrefs("<a href={'#'}>Add</a>").map((v) => v.rule)).toEqual([
      "hash-fragment",
    ]);
  });

  it("catches a javascript: pseudo-protocol href", () => {
    expect(findFakeLinkHrefs('<a href="javascript:void(0)">Add</a>').map((v) => v.rule)).toEqual([
      "javascript-protocol",
    ]);
    expect(findFakeLinkHrefs("<a href='javascript:doThing()'>Add</a>").map((v) => v.rule)).toEqual([
      "javascript-protocol",
    ]);
  });

  it("passes a bare hash line that carries the allow-marker", () => {
    expect(
      findFakeLinkHrefs(
        '<a href="#">Add</a> {/* diveday:allow-scroll-preservation: legacy anchor jump, ADR pending */}',
      ),
    ).toEqual([]);
  });

  it("leaves a clean file with neither pattern alone", () => {
    const source = [
      '<a href="#new-code" className={buttonClass({ className: "mt-4" })}>',
      "  Add a code",
      "</a>",
      '<button type="button" onClick={openMenu}>Menu</button>',
    ].join("\n");
    expect(findFakeLinkHrefs(source)).toEqual([]);
  });

  it("skips prose in comments quoting the pattern verbatim", () => {
    // Real comment text from src/app/s/[shopSlug]/trips/[id]/page.tsx and
    // EmbedBookedNotice.test.tsx, both describing the incident this rule
    // exists to catch rather than committing the shape themselves.
    const source = [
      '  // link used to be `href="#"` whenever no capability came back, and `#` under',
      '   * The link used to render `href="#"` under `aria-disabled` whenever no',
    ].join("\n");
    expect(findFakeLinkHrefs(source)).toEqual([]);
  });

  it("reports the line each violation is on", () => {
    const source = ["const a = 1;", "const b = 2;", '<a href="#">Add</a>'].join("\n");
    expect(findFakeLinkHrefs(source)).toEqual([
      { line: 3, shape: 'href="#"', rule: "hash-fragment" },
    ]);
  });

  it("never flags a real fragment href pointing at an element on the page", () => {
    expect(findFakeLinkHrefs('<a href="#invite">Add a teammate</a>')).toEqual([]);
    expect(
      findFakeLinkHrefs('<SkipLink href="#main-content" label={t("nav.skipToContent")} />'),
    ).toEqual([]);
  });
});
