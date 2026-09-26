// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REPEATING_ITEM_CARD_CLASS,
  repeatingItemRemoveClass,
} from "@/components/editor/RepeatingItemCard";
import { FieldGuideEditor, type FieldGuideEditorCopy } from "./FieldGuideEditor";

vi.mock("@/app/actions/marine-life-request", () => ({ requestMarineLifeSpecies: vi.fn() }));

afterEach(cleanup);

const copy: FieldGuideEditorCopy = {
  searchLabel: "Find a species",
  searchPlaceholder: "Stoplight parrotfish, or Sparisoma viride",
  add: "Add",
  empty: "No species yet",
  full: "That's the most species one guide can hold ({max}).",
  notFound: "Not in the catalog",
  requestSpecies: "Ask for it",
  requestSent: "Asked for {name}",
  remove: "Remove",
  removeAriaLabel: "Remove {name}",
  moveUp: "Up",
  moveUpAriaLabel: "Move {name} up",
  moveDown: "Down",
  moveDownAriaLabel: "Move {name} down",
};

/**
 * **The species box and its Add are one row, so they are one size.** The box
 * was the stacked field's 44px with its 16px type, and Add was `sm`: the same
 * height, and a 14px word beside a 16px one (`dive-site-edit`, 2026-09-25).
 * A control's type cannot come down to 14px, so the row is `md` and the box
 * stands at md's 48px.
 *
 * jsdom lays nothing out, so these pin which element carries which size and
 * where the caption lives, not the pixels.
 */
describe("FieldGuideEditor", () => {
  it("gives the species box and Add the md height and 16px type, and neither the sm or field size", () => {
    render(<FieldGuideEditor initialSlugs={[]} catalog={[]} copy={copy} />);
    const box = screen.getByRole("combobox", { name: copy.searchLabel });
    const add = screen.getByRole("button", { name: copy.add });
    expect(box).toHaveClass("min-h-12", "text-base");
    expect(box).not.toHaveClass("min-h-11");
    expect(add).toHaveClass("min-h-12", "text-base");
    expect(add).not.toHaveClass("text-sm");
  });

  it("draws each chosen species on the repeating-item card, its name and Remove at its head", () => {
    // It was a grey card at 12px of padding with a grey Remove at the end of
    // the Up/Down row, the fourth way the editors drew a repeating item.
    render(
      <FieldGuideEditor
        initialSlugs={["stoplight-parrotfish"]}
        catalog={[
          {
            slug: "stoplight-parrotfish",
            name: "Stoplight parrotfish",
            scientificName: "Sparisoma viride",
            kind: "Reef fish",
            description: "A heavy-beaked grazer.",
            imageUrl: "/marine-life/stoplight-parrotfish.jpg",
          },
        ]}
        copy={copy}
      />,
    );
    const card = screen.getByRole("listitem");
    const header = card.firstElementChild;
    const remove = screen.getByRole("button", { name: "Remove Stoplight parrotfish" });
    expect(card).toHaveClass(...REPEATING_ITEM_CARD_CLASS.split(" "));
    expect(header?.lastElementChild).toBe(remove);
    expect(header).toHaveTextContent("Stoplight parrotfish");
    expect(remove).toHaveClass(...repeatingItemRemoveClass.split(" "));
    // Up and Down stay together, in the card's body.
    expect(header).not.toContainElement(
      screen.getByRole("button", { name: "Move Stoplight parrotfish up" }),
    );
  });

  it("captions the box with a label of its own, which does not wrap the box", () => {
    // A label wrapping caption and box stood in the row as one tall block of
    // text beside Add, and the probe flagged it `text-beside-control`.
    render(<FieldGuideEditor initialSlugs={[]} catalog={[]} copy={copy} />);
    const box = screen.getByRole("combobox", { name: copy.searchLabel });
    const caption = screen.getByText(copy.searchLabel);
    expect(caption.tagName).toBe("LABEL");
    expect(caption).toHaveAttribute("for", box.id);
    expect(caption).not.toContainElement(box);
    expect(box.closest("label")).toBeNull();
  });
});
