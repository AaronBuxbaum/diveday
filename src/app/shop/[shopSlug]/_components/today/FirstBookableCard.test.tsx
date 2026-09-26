// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FirstBookableCard } from "./FirstBookableCard";

afterEach(cleanup);

const COPY = {
  heading: "Two-Tank Reef is on the board",
  body: "Divers can book it now.",
  linkLabel: "Your public schedule",
  copy: "Copy link",
  copied: "Copied",
  copyFailed: "Couldn’t copy",
  viewAsDiver: "See it the way your divers will",
};

function renderCard() {
  return render(
    <FirstBookableCard
      scheduleUrl="https://diveday.example/s/blue-mantis"
      scheduleHref="/s/blue-mantis"
      copy={COPY}
    />,
  );
}

describe("the first-bookable card", () => {
  /**
   * **It stands off the spine by the spine's own gap** (pixel-craft class 4,
   * K-316). The card sat `mb-6` above a spine whose sections sit `gap-10`
   * apart, so the one block between the header and the first station was
   * 24px from it where every block in the column is 40px from the next.
   */
  it("leaves the spine's 40px under it", () => {
    renderCard();
    const card = screen.getByRole("region", { name: COPY.heading });
    expect(card).toHaveClass("mb-10");
    expect(card).not.toHaveClass("mb-6");
  });

  /**
   * **The way to the public page is a thumb's target without being a taller
   * line** (pixel-craft class 7, K-452). It was a 17px-tall text link. A plain
   * `tapTargetLinkClass` would stack 12px of invisible target under the
   * card's last line (class 5), so the line keeps its 20px of flow and the
   * 44px box overhangs it: into the `mt-3` above and the card's padding below.
   */
  it("gives the view-as-diver link a 44px target on a 20px line", () => {
    renderCard();
    const link = screen.getByRole("link", { name: COPY.viewAsDiver });
    expect(link).toHaveAttribute("href", "/s/blue-mantis");
    expect(link).toHaveClass("inline-flex", "min-h-11", "items-center");
    expect(link.parentElement).toHaveClass("flex", "h-5", "items-center");
  });

  /**
   * **Its focus ring clears the link panel above it** (the reviewer's K-452
   * follow-up). The 44px box overhangs its 20px line by 12px, so under a
   * `mt-3` its top met the sunken panel's foot and the 5px outset ring drew
   * inside that panel. `button.ts` (`FLUSH_HOVER_FILL`) says a ring that
   * would cross a sunken box is drawn inset or given the room; inset, on a
   * link with no padding, it would sit on the first and last letters. So the
   * line stands `mt-5` off the panel: 8px between box and panel, 3px clear
   * of the ring, the same 3px it keeps from the card's border below at 390.
   */
  it("stands the link's line far enough off the panel for its ring", () => {
    renderCard();
    const line = screen.getByRole("link", { name: COPY.viewAsDiver }).parentElement;
    expect(line).toHaveClass("mt-5");
    expect(line).not.toHaveClass("mt-3");
  });
});
