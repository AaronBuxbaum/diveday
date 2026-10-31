// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { UnsavedSections } from "./EditorRail";
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

/** The form shell that contains section fields and the save-time note. */
function Editor() {
  return (
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
  );
}

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
    expect(pricing).toHaveAccessibleName("Pricing");
    expect(pricing?.className).not.toContain("rounded");
    // The hairline between sections is a `border-t`; the box it replaced was a
    // bare `border` with a radius and its own padding.
    expect(pricing?.className.split(" ")).not.toContain("border");
  });

  it("opens without a rule above it and separates the rest with one", () => {
    render(<Editor />);

    // A fieldset draws the rule on its legend, above the label, where a
    // section draws it on itself (EditorSection.test.tsx).
    const rule = (id: string) => {
      const section = document.getElementById(id);
      return section?.tagName === "FIELDSET" ? section.querySelector("legend") : section;
    };
    expect(rule("block-pitch")?.className).not.toContain("border-t");
    expect(rule("block-pricing")?.className).toContain("border-t border-border");
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
