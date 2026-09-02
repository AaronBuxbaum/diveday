// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionCard, sectionCardClass } from "./card";

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");

/**
 * The card's contract is mostly visual, but the parts a screenshot cannot
 * prove are here: there is exactly one radius and it is not configurable, the
 * heading is a real heading at the right level, and the shell string a
 * `loading.tsx` skeleton wears is the same one the card wears — a skeleton
 * that drifts from its page is a layout jump on every navigation.
 */
describe("sectionCardClass", () => {
  it("is one radius, and the ShopStat/Table spelling", () => {
    expect(sectionCardClass()).toBe(
      "rounded-panel border border-border bg-surface shadow-bed p-4 sm:p-5",
    );
  });

  it("drops the padding for a shell", () => {
    expect(sectionCardClass({ padding: "none" })).not.toMatch(/\bp-\d/);
    expect(sectionCardClass({ padding: "lg" })).toContain("p-5 sm:p-6");
  });

  /**
   * **Elevation is earned** — ADR 20260827-clearwater-surface-language,
   * decision 1. A panel at rest is a fill and a hairline; a shadow says the
   * thing floats above the page, which is true of a menu, a sheet, a dialog
   * and a toast and of nothing else. Asserted as "no shadow utility at all"
   * rather than as "not `shadow-sm`", because the failure this guards against
   * is somebody reaching for a *quieter* shadow rather than reaching for the
   * same one again.
   */
  it("emits the bed and never shadow-sm, at any padding or with any className", () => {
    for (const padding of ["none", "md", "lg"] as const) {
      expect(sectionCardClass({ padding }), padding).toMatch(/\bshadow-bed\b/);
      expect(sectionCardClass({ padding }), padding).not.toMatch(/\bshadow-sm\b/);
    }
    expect(sectionCardClass({ className: "scroll-mt-24" })).toMatch(/\bshadow-bed\b/);
  });

  /**
   * The prop is gone, not merely defaulted off. It existed so a card nested in
   * another card could stop stacking surface on surface; with no shadow at
   * rest there is nothing to stack, and leaving it accepted would let a call
   * site keep asking for an elevation it will never get.
   */
  it("takes no `elevated` option — the escape hatch is inert, not just off", () => {
    // `pnpm typecheck` refuses the prop at a call site; this is the runtime
    // half, for the JS a `.mjs` script or a stale build could still hand it.
    const forced = (sectionCardClass as (options: Record<string, unknown>) => string)({
      elevated: true,
    });
    expect(forced).toBe(sectionCardClass());
  });
});

/**
 * The primitive moving is only half of slice 13a. The other half is the tree:
 * a page whose `SectionCard`s sit at 28px on the bed and whose hand-rolled
 * panels still wear the retired 16px shell re-creates the opening complaint
 * of ADR 20260827-clearwater-surface-language — identically-shaped panels at
 * two radii on one page. This is the tree half, asserted mechanically rather
 * than remembered (ADR 20260901-diveday-reimagined, 13a).
 *
 * Two nets. The first says the retired shell is gone: no class string pairs
 * `rounded-2xl` with the panel's `border-border bg-surface`. The second keeps
 * Clearwater's rule for what the bed replaced: nothing wearing the panel's
 * radius wears `shadow-sm`, because the panel's elevation is `shadow-bed` and
 * nothing else — `shadow-sm` stays legitimate on a button, a thumb, a
 * segmented tile, the sticky chrome bar, none of which wear the panel radius.
 */
describe("every panel shell wears the panel radius and the bed", () => {
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  function offenders(test: (text: string) => boolean): string[] {
    return files(SRC_DIR)
      .filter((file) => {
        // Quoted and templated strings only, so a doc comment discussing the
        // retired token is not an offender. A class list lives in one such
        // string; a block comment never puts both tokens inside one of them.
        const strings = readFileSync(file, "utf8").match(/"[^"]*"|`[^`]*`/g) ?? [];
        return strings.some(test);
      })
      .map((file) => relative(SRC_DIR, file).split(/[\\/]/).join("/"));
  }

  it("finds no panel still wearing the retired rounded-2xl shell", () => {
    // Listed, not counted — a failure should name the file to open.
    expect(
      offenders(
        (text) =>
          /\brounded-2xl\b/.test(text) &&
          /\bborder-border\b/.test(text) &&
          /\bbg-surface\b/.test(text),
      ),
    ).toEqual([]);
  });

  it("finds no rounded-panel class string carrying shadow-sm", () => {
    expect(
      offenders((text) => /\brounded-panel\b/.test(text) && /\bshadow-sm\b/.test(text)),
    ).toEqual([]);
  });
});

describe("SectionCard", () => {
  it("wears one radius, whatever the call site asks for", () => {
    const { container } = render(
      <SectionCard className="scroll-mt-24">
        <p>Body</p>
      </SectionCard>,
    );
    const card = container.querySelector("section");
    expect(card).toHaveClass(
      "rounded-panel",
      "border",
      "border-border",
      "bg-surface",
      "shadow-bed",
    );
    // The bed is the panel's only elevation: never the ad-hoc `shadow-sm`.
    expect(card?.className).not.toMatch(/\bshadow-sm\b/);
    // The drift this component exists to end: no call site can reintroduce a
    // second radius through the escape hatch.
    expect(card?.className).not.toMatch(/rounded-(lg|xl|2xl|3xl)\b/);
    expect(card).toHaveClass("scroll-mt-24");
  });

  it("renders the title as a real heading, at the level the caller names", () => {
    render(<SectionCard title="Backups">body</SectionCard>);
    expect(screen.getByRole("heading", { level: 2, name: "Backups" })).toHaveClass(
      "text-lg",
      "font-semibold",
    );
    cleanup();
    render(
      <SectionCard title="Delivery history" titleAs="h3">
        body
      </SectionCard>,
    );
    // A card nested under a group's own h2 steps down, so the two do not shout
    // at the same volume.
    expect(screen.getByRole("heading", { level: 3, name: "Delivery history" })).toHaveClass(
      "text-base",
    );
  });

  it("owns the gap under its header, so no call site opens its body with a margin", () => {
    const { container } = render(
      <SectionCard title="Test message" description="Send one to your own phone.">
        <form data-testid="body" />
      </SectionCard>,
    );
    expect(screen.getByTestId("body").parentElement).toHaveClass("mt-4");
    // ...and carries no outer margin of its own: rhythm belongs to the page.
    expect(container.querySelector("section")?.className).not.toMatch(/\bm[tby]?-\d/);
  });

  it("renders no header wrapper at all when it has no heading", () => {
    const { container } = render(
      <SectionCard as="li" id="staff-1">
        <p>Ana Reyes</p>
      </SectionCard>,
    );
    const card = container.querySelector("li");
    expect(card).toHaveAttribute("id", "staff-1");
    // The body is the card's own child, not wrapped in a spacer that would put
    // 16px of nothing at the top of every row in a roster.
    expect(card?.firstElementChild?.tagName).toBe("P");
  });

  it("puts actions beside the heading", () => {
    render(
      <SectionCard title="Connected" actions={<span>Verified</span>}>
        body
      </SectionCard>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Connected" });
    const header = heading.parentElement?.parentElement;
    expect(header).toHaveClass("justify-between");
    expect(header).toContainElement(screen.getByText("Verified"));
  });
});

describe("naming the region", () => {
  it("labels a titled card with its own heading", () => {
    // The hand-rolled panels this replaces paired a written `aria-labelledby`
    // with a written heading id, and mostly did not bother. Deriving it means
    // the label cannot drift from the title.
    const { container } = render(<SectionCard title="Backups">body</SectionCard>);
    const section = container.querySelector("section");
    const heading = container.querySelector("h2");
    expect(heading?.id).toBeTruthy();
    expect(section?.getAttribute("aria-labelledby")).toBe(heading?.id);
  });

  it("gives two cards sharing a heading distinct ids", () => {
    // Two "Notes" cards on one page is legitimate, which is why the id comes
    // from useId rather than from a slug of the title.
    const { container } = render(
      <>
        <SectionCard title="Notes">one</SectionCard>
        <SectionCard title="Notes">two</SectionCard>
      </>,
    );
    const [first, second] = Array.from(container.querySelectorAll("h2"));
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });

  it("does not label an untitled card, or a list item", () => {
    // Nothing to point at; and an `li` is named by its content, so labelling
    // it would announce the heading twice.
    const { container } = render(<SectionCard>body</SectionCard>);
    expect(container.querySelector("section")?.hasAttribute("aria-labelledby")).toBe(false);

    const list = render(
      <SectionCard as="li" title="Rosa Delgado">
        row
      </SectionCard>,
    );
    expect(list.container.querySelector("li")?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("preserves aria-label when passed explicitly", () => {
    const { container: kebabContainer } = render(
      <SectionCard aria-label="Conservation commitments">body</SectionCard>,
    );
    expect(kebabContainer.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Conservation commitments",
    );

    const { container: camelContainer } = render(
      <SectionCard ariaLabel="Conservation commitments">body</SectionCard>,
    );
    expect(camelContainer.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Conservation commitments",
    );
  });
});
