// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonClass, tapTargetLineClass } from "@/components/ui/button";
import { LiveBoatPanel } from "./LiveBoatPanel";

afterEach(cleanup);

/**
 * The one place a live operational fact reaches an anonymous visitor (ADR
 * 20260904-reef-all-the-way-down, Budget rule 4). What may be published is
 * decided by `liveShopStage`; what this holds is that the panel says what it
 * was given and claims nothing more.
 */
describe("LiveBoatPanel", () => {
  it("says where the boat is and when the crew said so", () => {
    render(
      <LiveBoatPanel
        stage="underway"
        eyebrow="Right now"
        sentence="Mantis II is out on Molasses Reef."
        meta="The crew said so at 7:04 AM. Back around 11:30 AM."
      />,
    );
    expect(screen.getByText("Mantis II is out on Molasses Reef.")).toBeInTheDocument();
    expect(screen.getByText(/The crew said so at 7:04 AM/)).toBeInTheDocument();
  });

  it("names no person and no position", () => {
    const { container } = render(
      <LiveBoatPanel
        stage="underway"
        eyebrow="Right now"
        sentence="Mantis II is out on Molasses Reef."
        meta="The crew said so at 7:04 AM."
      />,
    );
    // A visitor is told a boat is out, not who is on it or where it is.
    expect(container.textContent).not.toMatch(/\d+\.\d+°|lat|lon|position/i);
  });

  /**
   * The Follow door (ADR 20260908-one-hand, decision 6, lever U). Optional,
   * because the panel is older than the switch that gates the door — and the
   * page above decides, since `liveShopStage` is not even read for a shop
   * that has not turned the line on.
   */
  it("offers no door of its own until the page hands it one", () => {
    render(
      <LiveBoatPanel
        stage="underway"
        eyebrow="Right now"
        sentence="Mantis II is out on Molasses Reef."
        meta="The crew said so at 7:04 AM."
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens the boat's own day when it is given one", () => {
    render(
      <LiveBoatPanel
        stage="underway"
        eyebrow="Right now"
        sentence="Mantis II is out on Molasses Reef."
        meta="The crew said so at 7:04 AM."
        follow={{ href: "/s/blue-mantis/boats/trip-1", label: "Follow" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Follow" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/boats/trip-1",
    );
  });
});

/**
 * **The identity band's two text links are one link** (pixel-craft K-219).
 * "Follow" was hand-rolled at 16px with a square ring beside the season
 * band's 14px `link` button with a rounded one; and as a 44px box last in the
 * card it put 32px under its words against 16px over the card's icon (K-185).
 */
describe("the Follow door's line", () => {
  function follow() {
    render(
      <LiveBoatPanel
        stage="underway"
        eyebrow="Right now"
        sentence="Mantis II is out on Molasses Reef."
        meta="The crew said so at 7:04 AM."
        follow={{ href: "/s/blue-mantis/boats/trip-1", label: "Follow" }}
      />,
    );
    return screen.getByRole("link", { name: "Follow" });
  }

  it("is drawn the way the season band's link is: sm, flush with the words above", () => {
    expect(follow().className).toBe(buttonClass({ variant: "link", size: "sm", flush: true }));
  });

  it("stands on a line exactly its words' height, so its target adds nothing under the card", () => {
    const link = follow();
    const line = link.parentElement;
    expect(line?.tagName).toBe("P");
    expect(line).toHaveClass(...tapTargetLineClass.split(" "), "mt-2");
    // The line owns the spacing; a margin on the inline-flex link would move
    // its box, not the line it stands on.
    expect(link.className).not.toMatch(/(?:^|\s)-?m[tby]-/);
  });
});
