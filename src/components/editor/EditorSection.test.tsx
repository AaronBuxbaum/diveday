// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
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
  it("draws a fieldset section's rule and air above its label, on the legend, not the fieldset", () => {
    render(
      <EditorSection id="block-route" label="The route you swim" as="fieldset">
        <input aria-label="Entry" />
      </EditorSection>,
    );
    const fieldset = screen.getByRole("group", { name: "The route you swim" });
    const legend = fieldset.firstElementChild;

    expect(legend?.tagName).toBe("LEGEND");
    // The full measure, so the hairline spans the column as a section's does.
    expect(legend).toHaveClass("w-full", "border-t", "border-border", "pt-6");
    expect(shellTokens(fieldset)).toEqual([]);
  });

  it("opens the form's first fieldset with no rule above its label", () => {
    render(
      <EditorSection id="block-pitch" label="The pitch" as="fieldset" lead>
        <input aria-label="Subhead" />
      </EditorSection>,
    );
    const legend = screen.getByRole("group", { name: "The pitch" }).firstElementChild;
    expect(shellTokens(legend)).toEqual([]);
  });

  it("anchors the rail and the unsaved note on the named group itself", () => {
    // The rail links to the id and the unsaved note traces a typed control back
    // through the marker, so both sit on the section's outermost element, and
    // for a fieldset that is the group a screen reader names.
    const { container } = render(
      <EditorSection id="block-route" label="The route you swim" as="fieldset">
        <input aria-label="Entry" />
      </EditorSection>,
    );
    const group = screen.getByRole("group", { name: "The route you swim" });
    expect(container.firstElementChild).toBe(group);
    expect(group).toHaveAttribute("id", "block-route");
    expect(group).toHaveAttribute("data-editor-section", "block-route");
    expect(group).toHaveClass("scroll-mt-6");
  });

  /**
   * The course editor's refused day-by-day save redirects with
   * `?field=scheduleDaysJson`, the section's id, and `FieldErrorFocus` focuses
   * whatever carries it. On an unnamed box around the fieldset, focus landed on
   * a generic element with no role or name; it lands on the group, so a screen
   * reader hears which section it has to fix.
   */
  it("lands a refused save's focus on the named group", () => {
    render(
      <>
        <EditorSection id="scheduleDaysJson" label="Day by day" as="fieldset">
          <input type="hidden" name="scheduleDaysJson" value="[]" />
        </EditorSection>
        <FieldErrorFocus field="scheduleDaysJson" />
      </>,
    );
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Day by day" }));
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
