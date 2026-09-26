// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorSection } from "./EditorSection";

afterEach(cleanup);

/** A class list's tokens that draw a box edge or pad one: `border-t`, `pt-6`. */
function shellTokens(element: Element | null): string[] {
  return [...(element?.classList ?? [])].filter((token) => /^(border|p[tbxy]?-)/.test(token));
}

/**
 * **One heading geometry for both kinds of section** (docs/design/
 * pixel-craft.md, class 12). A `<fieldset>` draws its `<legend>` *in* its own
 * top border, so the hairline and `pt-6` on the fieldset itself put the label
 * on the rule and the 24px between the label and the fields: 27–28px from the
 * previous section to the label and 40px from the label to its fields, where a
 * `<section>`'s label sits 29px under its rule. The rule belongs above the label
 * in both.
 */
describe("EditorSection", () => {
  it("draws a fieldset section's rule and air on a box around the fieldset, not on it", () => {
    render(
      <EditorSection id="block-route" label="The route you swim" as="fieldset">
        <input aria-label="Entry" />
      </EditorSection>,
    );
    const fieldset = screen.getByRole("group", { name: "The route you swim" });
    const shell = fieldset.parentElement;

    expect(shell).toHaveClass("border-t", "border-border", "pt-6");
    expect(shellTokens(fieldset)).toEqual([]);
  });

  it("keeps the anchor and the unsaved-note marker on the box that carries the rule", () => {
    // The rail links to the id and the unsaved note traces a typed control back
    // through the marker, so both stay on the outermost element of the section.
    const { container } = render(
      <EditorSection id="block-route" label="The route you swim" as="fieldset">
        <input aria-label="Entry" />
      </EditorSection>,
    );
    const shell = container.firstElementChild;
    expect(shell).toHaveAttribute("id", "block-route");
    expect(shell).toHaveAttribute("data-editor-section", "block-route");
    expect(shell).toHaveClass("scroll-mt-6");
    expect(shell?.querySelector("fieldset")).not.toBeNull();
  });

  it("draws a section's rule on the section itself, the geometry the fieldset now matches", () => {
    const { container } = render(
      <EditorSection id="block-dive" label="The dive">
        <input aria-label="Depth" />
      </EditorSection>,
    );
    const shell = container.firstElementChild;
    expect(shell?.tagName).toBe("SECTION");
    expect(shell).toHaveClass("border-t", "border-border", "pt-6");
  });
});
