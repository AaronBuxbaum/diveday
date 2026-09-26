// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LandmarkEditor, type LandmarkEditorCopy } from "./LandmarkEditor";

afterEach(cleanup);

const copy: LandmarkEditorCopy = {
  nameLabel: "Landmark",
  namePlaceholder: "Molasses Reef Light",
  kindLabel: "What kind",
  kindLabels: {
    pointOfInterest: "Point of interest",
    navigationMark: "Navigation mark",
    reefFormation: "Reef formation",
    reefHistory: "Reef history",
    wreckFeature: "Wreck feature",
    underwaterMonument: "Underwater monument",
  },
  noteLabel: "What to say about it",
  notePlaceholder: "The easiest above-water reference.",
  add: "Add a landmark",
  remove: "Remove",
  removeAriaLabel: "Remove the landmark {name}",
  empty: "No landmarks yet.",
  full: "That's the most landmarks one site can carry.",
};

function renderOne() {
  render(
    <LandmarkEditor
      initialLandmarks={[{ name: "Molasses Reef Light", kind: "navigationMark", note: "" }]}
      copy={copy}
    />,
  );
  const row = screen.getByRole("listitem");
  return {
    name: within(row).getByRole("textbox", { name: copy.nameLabel }),
    kind: within(row).getByRole("combobox", { name: copy.kindLabel }),
    note: within(row).getByRole("textbox", { name: copy.noteLabel }),
    remove: within(row).getByRole("button", { name: "Remove the landmark Molasses Reef Light" }),
  };
}

/**
 * **A landmark's row is the field guide's row, on the same page: one `md`
 * size.** The name box and the kind select are 16px controls, and Remove was
 * `sm`, a 14px word beside them; the field guide beside it was moved to `md`
 * on 2026-09-25, so the editor drew its two rows at two sizes.
 *
 * jsdom lays nothing out, so these pin which element carries which size and
 * where each caption lives, not the pixels.
 */
describe("LandmarkEditor", () => {
  it("gives the name box, the kind select and Remove the md height and 16px type", () => {
    const { name, kind, remove } = renderOne();
    for (const control of [name, kind, remove]) {
      expect(control).toHaveClass("min-h-12", "text-base");
      expect(control).not.toHaveClass("text-sm");
    }
    expect(name).not.toHaveClass("min-h-11");
    expect(kind).not.toHaveClass("min-h-11");
  });

  // A textarea is sized by its lines, not by a button's rung: it shows its
  // two rows and grows with its text (`textareaClassFor`, K-46).
  it("leaves the note, which has no button on its line, at its own two rows", () => {
    const { note } = renderOne();
    expect(note).toHaveClass("field-sizing-content", "min-h-[calc(2lh+1.125rem)]", "text-base");
    expect(note).not.toHaveClass("min-h-12");
  });

  it("captions every control with a label of its own, which does not wrap the control", () => {
    const { name, kind, note } = renderOne();
    for (const [control, caption] of [
      [name, copy.nameLabel],
      [kind, copy.kindLabel],
      [note, copy.noteLabel],
    ] as const) {
      const label = screen.getByText(caption);
      expect(label.tagName).toBe("LABEL");
      expect(label).toHaveAttribute("for", control.id);
      expect(control.closest("label")).toBeNull();
    }
  });
});
