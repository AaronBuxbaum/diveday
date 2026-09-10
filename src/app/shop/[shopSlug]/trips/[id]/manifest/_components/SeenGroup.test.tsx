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
  offlineLabel: "Offline — a tap will not save until the boat has bars",
  connectivity: {
    online: "Online",
    onlineTitle: "This device is online.",
    offlineTitle: "This device has no connection right now.",
  },
};

/**
 * `navigator.onLine` is read in an effect, so it has to be set **before**
 * render — the pattern `ConnectivityStatus.test.tsx` documents. jsdom does not
 * define it as a configurable accessor, so this defines one rather than spying
 * on a property that is not there.
 */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

// Every other case in this file is about a connected boat, and a stale `false`
// left by the offline cases below would silently put the warning on all of them.
afterEach(() => setOnline(true));

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

  it("keeps the group off the printed sheet", () => {
    // The printed packet is the fallback under the fallback — a sheet a crew
    // carries when the phones are gone — and a page of species buttons nobody
    // can press is paper spent on an ornament. Every sibling after-dive control
    // is `print:hidden` for the same reason (`TripPlanSection`).
    const { container } = render(
      <SeenGroup chips={chips} tallies={[]} copy={copy} recordAction={noop} deleteAction={noop} />,
    );
    expect(container.querySelector("section")?.className).toContain("print:hidden");
  });

  it("keeps the chip row in the order the server sent, whatever has been logged", () => {
    // A row that floated tapped species to the front would rearrange itself
    // under a thumb already reaching for the next one, on a moving deck. The
    // tally below is what says which have been seen.
    render(
      <SeenGroup
        chips={chips}
        tallies={[
          {
            slug: "nurse-shark",
            name: "Nurse shark",
            count: 2,
            deleteLabel: "Delete Nurse shark",
          },
        ]}
        copy={copy}
        recordAction={noop}
        deleteAction={noop}
      />,
    );
    const row = screen
      .getAllByRole("button")
      .filter((button) => chips.some((chip) => chip.name === button.textContent));
    expect(row.map((button) => button.textContent)).toEqual(chips.map((chip) => chip.name));
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

  /**
   * **Offline, said before the tap** (issue #1625).
   *
   * The surface interval between two tanks is the only moment a crew will ever
   * tap these chips, and it is also the moment a boat has no bars. The refusal
   * is honest and it arrives too late to be useful, so the group warns first.
   */
  it("says a tap will not save, before anyone taps", () => {
    setOnline(false);
    render(
      <SeenGroup chips={chips} tallies={[]} copy={copy} recordAction={noop} deleteAction={noop} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Offline — a tap will not save until the boat has bars",
    );
    // The chips stay tappable under it. A dead chip on a wet deck reads as a
    // broken app rather than as a missing bar, and the browser's flag is not
    // reachability: a boat with one bar reports itself online, and one with
    // none may have a bar back by the time the thumb lands.
    for (const chip of chips) {
      expect(screen.getByRole("button", { name: chip.name })).toBeEnabled();
    }
    // The warning is a prediction, not a refusal. Nothing has been refused yet.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says nothing about the connection while there is one", () => {
    setOnline(true);
    render(
      <SeenGroup chips={chips} tallies={[]} copy={copy} recordAction={noop} deleteAction={noop} />,
    );
    // No permanently green badge on a surface where connectivity is not the
    // subject — the absence of the warning is what reads as "fine".
    expect(screen.queryByRole("status")).toBeNull();
  });
});
