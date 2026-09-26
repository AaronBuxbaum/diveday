// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { EditorRail, EditorRailSkeleton, UnsavedSections } from "./EditorRail";
import { EditorSection, type EditorSectionRef, type EditorUnsavedCopy } from "./EditorSection";

afterEach(cleanup);

const SECTIONS: EditorSectionRef[] = [
  { id: "block-pitch", label: "The pitch" },
  { id: "block-pricing", label: "Pricing" },
  { id: "block-photos", label: "Photos" },
];

/**
 * The sentences a server would have resolved: one per section, one per count.
 * The component never interpolates — see `EditorUnsavedCopy`.
 */
const COPY: EditorUnsavedCopy = {
  inSection: SECTIONS.map((section) => `Unsaved changes in ${section.label}`),
  inSections: ["", "", "Unsaved changes in 2 sections", "Unsaved changes in 3 sections"],
};

/** The two halves as a page mounts them: rail outside the form, note inside it. */
function Editor() {
  return (
    <div>
      <EditorRail sections={SECTIONS} navLabel="On this page" />
      <form>
        <EditorSection id="block-pitch" label="The pitch" lead>
          <input aria-label="One sentence" name="summary" />
        </EditorSection>
        <EditorSection id="block-pricing" label="Pricing" as="fieldset">
          <input aria-label="Price" name="price" />
        </EditorSection>
        <EditorSection id="block-photos" label="Photos" as="fieldset">
          <input aria-label="Hero alt text" name="heroAlt" />
        </EditorSection>
        <UnsavedSections sections={SECTIONS} copy={COPY} />
      </form>
    </div>
  );
}

/** The rail proper — the pinned one, not the phone jump row beside it. */
function railNav(): HTMLElement {
  const nav = screen
    .getAllByRole("navigation", { name: "On this page" })
    .find((candidate) => candidate.className.includes("lg:sticky"));
  if (!nav) throw new Error("no pinned rail rendered");
  return nav;
}

describe("the editor rail", () => {
  /**
   * The pin ADR 20260827-the-shops-shelves' editor pattern turns on: the rail
   * *names the sections*, so a section the rail names with nothing under it is
   * a section a staffer cannot reach. Checked against the anchors rather than
   * against a snapshot, because that is the rule — a restyle may move every
   * pixel and must not break this.
   */
  it("reaches every section it names", () => {
    render(<Editor />);

    for (const section of SECTIONS) {
      const links = screen.getAllByRole("link", { name: section.label });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute("href", `#${section.id}`);
      // The anchor's destination exists, and it is the element carrying the
      // section's own name.
      const target = document.getElementById(section.id);
      expect(target).not.toBeNull();
      expect(target?.textContent).toContain(section.label);
    }
  });

  /**
   * The chrome bar's height is a token, never a number
   * (ADR 20260827-clearwater-surface-language, decision 10). The settings rail
   * got this wrong once and `src/components/chrome/chrome.test.ts` caught the
   * measured offset; this is the same rule stated where the rail lives, so a
   * rail that stops pinning at all is caught too.
   */
  it("pins under the chrome bar by reading its height", () => {
    render(<Editor />);

    const rail = railNav();
    expect(rail.className).toContain("lg:sticky");
    expect(rail.className).toContain("lg:top-(--chrome-h)");
  });

  /**
   * **One landmark, whatever the width.** This rail was first written as the
   * app's `JumpNav` for the phone beside a sticky column for the desktop, which
   * read as reuse of the one "places on this page" grammar — but `JumpNav`
   * brings a `<nav>` of its own, so the editor offered two landmarks under one
   * name and a screen reader read the same anchor list twice. `lg:hidden` does
   * not help: both are in the accessibility tree at every width. The list
   * changes shape at `lg`; the landmark does not.
   */
  /**
   * The current section's tint is a desktop state (`lg:bg-primary-tint`), and a
   * bare `hover:bg-surface-sunken` on every row outranked it: under the
   * pointer the one tinted row went grey with foreground text. Hover belongs to
   * the rows that are not current, and to the current one only below `lg`,
   * where it carries no tint to lose.
   */
  it("keeps the current section's tint under the pointer", () => {
    render(<Editor />);

    const rail = railNav();
    const tokens = (link: Element | null | undefined) => link?.className.split(/\s+/) ?? [];
    const current = tokens(rail.querySelector("a[aria-current='true']"));
    expect(current).toContain("lg:bg-primary-tint");
    expect(current).not.toContain("hover:bg-surface-sunken");
    expect(current).not.toContain("hover:text-foreground");
    expect(current).toContain("max-lg:hover:bg-surface-sunken");

    const other = tokens(rail.querySelector("a:not([aria-current])"));
    expect(other).toContain("hover:bg-surface-sunken");
    expect(other).toContain("hover:text-foreground");
  });

  it("is one navigation landmark, holding every anchor exactly once", () => {
    render(<Editor />);

    const navs = screen.getAllByRole("navigation", { name: "On this page" });
    expect(navs).toHaveLength(1);
    expect(
      Array.from(navs[0].querySelectorAll("a")).map((link) => link.getAttribute("href")),
    ).toEqual(SECTIONS.map((section) => `#${section.id}`));
  });
});

/**
 * **The rail's skeleton is the rail's geometry** (docs/design/pixel-craft.md,
 * class 11: 0px of shift on load). The editors' loading pages drew the phone
 * rail as one row of three 36px pills over a hairline with `mb-8`, about 77px;
 * the loaded rail at 390 is a borderless wrap of 44px links with `mb-6`, so on
 * the new-site editor the whole form dropped about 131px when it arrived.
 */
describe("the editor rail's skeleton", () => {
  it("draws one 44px stub per section, in the rail's own two boxes", () => {
    render(<Editor />);
    const rail = railNav();
    const list = rail.querySelector("ul");
    const { container } = render(<EditorRailSkeleton count={11} />);
    const skeleton = container.firstElementChild;
    const stubs = skeleton?.firstElementChild;

    expect(skeleton?.className).toBe(rail.className);
    expect(stubs?.className).toBe(list?.className);
    expect(skeleton).toHaveClass("mb-6", "lg:pt-1");
    expect(skeleton).not.toHaveClass("border-b");
    expect(stubs).toHaveClass("flex-wrap");
    expect(stubs?.children).toHaveLength(11);
    for (const stub of stubs?.children ?? []) expect(stub).toHaveClass("h-11");
  });
});

describe("the unsaved-changes sentence", () => {
  it("says nothing until something is edited", () => {
    render(<Editor />);

    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
  });

  /**
   * One Save, ten sections, four thousand pixels: the sentence's whole job is
   * to say *which* section the button still owes something to.
   */
  it("names the one section that was edited", async () => {
    render(<Editor />);

    await userEvent.type(screen.getByLabelText("Price"), "595");

    expect(await screen.findByText("Unsaved changes in Pricing")).toBeVisible();
  });

  /**
   * The sentence sits in `StickyFormActions` beside the one Save, a `gap-3`
   * row. Empty, it was still a flex item, so the pixel probe found it taking
   * 12px after the button on every dive-site editor capture. It cannot simply
   * be left out: a live region has to be in the document before its words
   * change, or the change is never announced. So it stays, out of the row's
   * flow, until it has something to say.
   */
  it("stays in the document while silent, but out of the action row's flow", async () => {
    const { container } = render(<Editor />);
    const region = container.querySelector("form [aria-live='polite']");
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass("absolute");

    await userEvent.type(screen.getByLabelText("Price"), "595");

    expect(await screen.findByText("Unsaved changes in Pricing")).toBe(region);
    expect(region).not.toHaveClass("absolute");
  });

  it("counts once more than one section is edited", async () => {
    render(<Editor />);

    await userEvent.type(screen.getByLabelText("One sentence"), "Three days from pool to reef.");
    await userEvent.type(screen.getByLabelText("Price"), "595");

    expect(await screen.findByText("Unsaved changes in 2 sections")).toBeVisible();
    expect(screen.queryByText("Unsaved changes in The pitch")).toBeNull();
  });
});

describe("an editor section", () => {
  /**
   * The border is what the pattern removes; the grouping semantics are what it
   * keeps (ADR 20260827-the-shops-shelves, "Alternatives considered": "The
   * `<fieldset>` elements may stay for semantics; their borders go").
   */
  it("keeps the fieldset and drops its box", () => {
    render(<Editor />);

    const pricing = document.getElementById("block-pricing");
    expect(pricing?.tagName).toBe("FIELDSET");
    expect(pricing?.querySelector("legend")?.textContent).toBe("Pricing");
    expect(pricing?.className).not.toContain("rounded");
    // The hairline between sections is a `border-t`; the box it replaced was a
    // bare `border` with a radius and its own padding.
    expect(pricing?.className.split(" ")).not.toContain("border");
  });

  it("opens without a rule above it and separates the rest with one", () => {
    render(<Editor />);

    expect(document.getElementById("block-pitch")?.className).not.toContain("border-t");
    expect(document.getElementById("block-pricing")?.className).toContain("border-t border-border");
  });

  /**
   * An anchor jump has to land the label below the bar, not behind it — and
   * since #1941 the bar's own height is not this component's to carry. One
   * `scroll-padding-top: var(--chrome-h)` on `html` insets every scroll in the
   * app, so what is left here is the *air* between the bar and the label.
   * Scroll padding and scroll margin add, so a `--chrome-h` still spelled here
   * would land the label a whole bar too low; `chrome.test.ts` holds the other
   * half, that the stylesheet declares the padding at all.
   */
  it("keeps its own air above an anchored label, and leaves the bar to the stylesheet", () => {
    render(<Editor />);

    for (const section of SECTIONS) {
      const className = document.getElementById(section.id)?.className ?? "";
      expect(className, section.id).toContain("scroll-mt-6");
      expect(className, `${section.id} double-counts the bar`).not.toContain("--chrome-h");
    }
  });
});
