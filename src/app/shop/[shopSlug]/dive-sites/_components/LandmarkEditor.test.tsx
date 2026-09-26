// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPEATING_ITEM_CARD_CLASS,
  repeatingItemAddClass,
  repeatingItemRemoveClass,
} from "@/components/editor/RepeatingItemCard";
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
    row,
    name: within(row).getByRole("textbox", { name: copy.nameLabel }),
    kind: within(row).getByRole("combobox", { name: copy.kindLabel }),
    note: within(row).getByRole("textbox", { name: copy.noteLabel }),
    remove: within(row).getByRole("button", { name: "Remove the landmark Molasses Reef Light" }),
  };
}

/**
 * **A landmark is the editors' one repeating-item card** (docs/design/
 * pixel-craft.md, class 12). It was a grey card at 12px of padding with a grey
 * Remove standing in the row of fields, where the course editor's days and
 * questions and the field guide beside it drew their Remove three other ways.
 * Remove now sits at the head of the card, so the name box and the kind select
 * are a row of controls only, which stands at the field size.
 *
 * jsdom lays nothing out, so these pin which element carries which size and
 * where each caption lives, not the pixels.
 */
describe("LandmarkEditor", () => {
  it("draws each landmark on the repeating-item card, with Remove at its head", () => {
    const { row, name, remove } = renderOne();
    expect(row).toHaveClass(...REPEATING_ITEM_CARD_CLASS.split(" "));
    expect(row.firstElementChild?.lastElementChild).toBe(remove);
    expect(row.firstElementChild).not.toContainElement(name);
    expect(remove).toHaveClass(...repeatingItemRemoveClass.split(" "));
    expect(screen.getByRole("button", { name: copy.add })).toHaveClass(
      ...repeatingItemAddClass.split(" "),
    );
  });

  it("stands the name box and the kind select, a row of controls only, at the field size", () => {
    const { name, kind } = renderOne();
    for (const control of [name, kind]) {
      expect(control).toHaveClass("min-h-11", "text-base");
      expect(control).not.toHaveClass("min-h-12");
    }
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
