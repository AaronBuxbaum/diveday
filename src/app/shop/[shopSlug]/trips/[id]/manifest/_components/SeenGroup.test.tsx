// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeenGroup, type SeenGroupCopy } from "./SeenGroup";

/**
 * **The crew's Seen group** (slice 20r, the living reef). It rides the manifest
 * and it is not a safety control: nothing here gates anything, and every
 * assertion below is about what a crew can reach with one wet hand.
 */
const copy: SeenGroupCopy = {
  heading: "Seen",
  consequence: "At Molasses Reef. Divers read this on the trip page.",
  delete: "Delete",
  refusal: "That did not save. Tap it again.",
};

const chips = [
  { slug: "green-sea-turtle", name: "Green sea turtle" },
  { slug: "nurse-shark", name: "Nurse shark" },
];

const noop = async () => ({ status: "ok" }) as const;

afterEach(cleanup);

describe("SeenGroup", () => {
  it("offers every face as its own tap", () => {
    render(
      <SeenGroup chips={chips} tallies={[]} copy={copy} recordAction={noop} deleteAction={noop} />,
    );
    for (const chip of chips) {
      expect(screen.getByRole("button", { name: chip.name })).toBeInTheDocument();
    }
    // A group with nothing logged shows no list at all — an empty list under
    // the chips would be the surface apologising for a tap nobody has made.
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("says the count, and says Delete", () => {
    render(
      <SeenGroup
        chips={chips}
        tallies={[
          {
            slug: "green-sea-turtle",
            name: "Green sea turtle",
            count: 3,
            deleteLabel: "Delete Green sea turtle",
          },
        ]}
        copy={copy}
        recordAction={noop}
        deleteAction={noop}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveTextContent("Green sea turtle");
    // The list is the tap's whole answer, so the number has to be on it.
    expect(row).toHaveTextContent("3");
    // Every delete is soft and the word on screen is still "Delete" (ADR
    // 20260820-every-delete-is-soft) — never Remove, Clear or Undo.
    expect(screen.getByRole("button", { name: "Delete Green sea turtle" })).toHaveTextContent(
      "Delete",
    );
  });

  it("names the reef the taps attach to, and that they leave the shop", () => {
    // The one line that earns its place: which site, and that a diver reads it.
    // Both are consequences the chips cannot show on their own.
    render(
      <SeenGroup chips={chips} tallies={[]} copy={copy} recordAction={noop} deleteAction={noop} />,
    );
    expect(
      screen.getByText("At Molasses Reef. Divers read this on the trip page."),
    ).toBeInTheDocument();
    // And no refusal until something is refused.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives every tap a boat-sized target", () => {
    const { container } = render(
      <SeenGroup chips={chips} tallies={[]} copy={copy} recordAction={noop} deleteAction={noop} />,
    );
    // 44px, the floor every size clears, on a wet deck with one hand.
    for (const button of container.querySelectorAll("form button")) {
      expect(button.className).toContain("min-h-11");
    }
    // And `touch-manipulation` on the chips themselves, so a *second* tap on
    // one of them does not land in the browser's 300ms double-tap-to-zoom wait
    // — which is the whole interaction, not an edge of it.
    for (const chip of chips) {
      expect(screen.getByRole("button", { name: chip.name }).className).toContain(
        "touch-manipulation",
      );
    }
  });
});
