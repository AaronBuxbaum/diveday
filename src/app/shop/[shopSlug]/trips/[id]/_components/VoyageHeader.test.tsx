// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
import { TripAddDiverLink } from "./TripPageHeader";
import { VoyageHeader } from "./VoyageHeader";

afterEach(cleanup);

/**
 * The line of facts read as a person reads it: the paragraph's whole text, with
 * its no-break spaces read as spaces. Each fact is a box of its own, so no one
 * element's own text is the line.
 */
function factsLine(text: string) {
  return screen.getByText(
    (_, element) => element?.tagName === "P" && element.textContent?.replace(/\s+/g, " ") === text,
  );
}

describe("VoyageHeader", () => {
  /**
   * **The hour is the name.** A crew standing on a dock at 6:58 knows which
   * trip it is; what they need first is the time it leaves. So the time takes
   * the display size, and the title reads under it — which means the `<h1>` is
   * the title and the hour is not a heading competing with it.
   */
  it("leads with the hour and keeps the title as the page's heading", () => {
    const { container } = render(
      <VoyageHeader
        back={<a href="/shop/blue-mantis/schedule/board">Board</a>}
        hour="7:00 AM"
        title="Two-Tank Reef — Molasses & French"
        facts={["Mantis I", "Keiko Tanaka", "9 of 12 seats taken"]}
      />,
    );
    expect(container.querySelector(".font-rounded")?.textContent).toBe("7:00 AM");
    expect(
      screen.getByRole("heading", { level: 1, name: "Two-Tank Reef — Molasses & French" }),
    ).toBeTruthy();
    expect(factsLine("Mantis I · Keiko Tanaka · 9 of 12 seats taken")).toBeTruthy();
  });

  /**
   * **The line breaks between facts, never inside one** (pixel-craft class 8,
   * K-158). It was one string joined with " · ", so the browser broke it at
   * any space: "· Tue," / "Jul 21" on a crew-clash departure at 390, and "9 of
   * 12 seats" / "taken" on another. Each fact is now its own atomic box, so a
   * line ends only between two of them; one longer than the whole line still
   * wraps inside its own box rather than running off a phone, which a boat or a
   * crew name — free text a shop typed — could. The dot rides inside the fact
   * before it: a line can break on either side of an atomic box whatever
   * character stands there, so a dot outside one could start a line.
   */
  it("sets each fact whole, with its dot kept on the fact before it", () => {
    render(
      <VoyageHeader
        back={<a href="/back">Board</a>}
        hour="7:00 AM"
        title="Two-Tank Reef"
        facts={["Blue Mantis", "Sal Moretti", "9 of 12 seats taken", "Tue, Jul 21"]}
      />,
    );
    const line = factsLine("Blue Mantis · Sal Moretti · 9 of 12 seats taken · Tue, Jul 21");
    const pieces = [...line.children];
    expect(pieces.map((piece) => piece.textContent)).toEqual([
      "Blue Mantis\u00a0·",
      "Sal Moretti\u00a0·",
      "9 of 12 seats taken\u00a0·",
      "Tue, Jul 21",
    ]);
    for (const piece of pieces) {
      expect(piece.tagName).toBe("SPAN");
      expect(piece).toHaveClass("inline-block");
      expect(piece.className).not.toContain("whitespace-nowrap");
    }
    expect(line.textContent).toBe(
      "Blue Mantis\u00a0· Sal Moretti\u00a0· 9 of 12 seats taken\u00a0· Tue, Jul 21",
    );
  });

  /**
   * **The crew's names are the desktop's** (phone text density pass). Below
   * `sm` a crew fact steps aside with its own dot and the space after it, so
   * the phone's line is the boat, the count, the day and the price, and never
   * starts or ends on a stray dot.
   */
  it("hides a desktop fact below `sm` together with its dot", () => {
    render(
      <VoyageHeader
        back={<a href="/back">Board</a>}
        hour="7:00 AM"
        title="Two-Tank Reef"
        facts={["Mantis I", { text: "Sal Moretti", desktop: true }, "9 of 12 seats taken"]}
      />,
    );
    const line = factsLine("Mantis I · Sal Moretti · 9 of 12 seats taken");
    const crew = [...line.children].find((piece) => piece.textContent?.startsWith("Sal"));
    expect(crew).toHaveClass("inline-block", "max-sm:hidden");
    expect(crew?.textContent).toBe("Sal Moretti\u00a0·");
    expect(crew?.nextElementSibling).toHaveClass("max-sm:hidden");
    expect(screen.getByText("Mantis I", { exact: false })).not.toHaveClass("max-sm:hidden");
  });

  /**
   * **The header's two controls stand 8px apart** (pixel-craft class 4, K-163).
   * The page hands Manifest and Add diver over as a fragment, and two inline
   * boxes from a fragment have no space between them, so one painted over the
   * other's focus ring, which reaches 5px out. The slot lays its children out
   * itself, `gap-2`, more than the ring's reach.
   */
  it("spaces the controls it is handed a gap wider than the focus ring", () => {
    render(
      <VoyageHeader
        back={<a href="/back">Board</a>}
        hour="2:30 PM"
        title="Two-Tank Reef"
        facts={["Mantis I", "9 of 12 seats taken"]}
        action={
          <>
            <a href="/manifest">Manifest</a>
            <a href="#add-diver">Add diver</a>
          </>
        }
      />,
    );
    const slot = screen.getByRole("link", { name: "Manifest" }).parentElement;
    expect(slot).toBe(screen.getByRole("link", { name: "Add diver" }).parentElement);
    expect(slot).toHaveClass("flex", "items-center", "gap-2");
  });

  /**
   * **A blow-out leads.** It is the first thing a crew must read, so it sits
   * beside the hour rather than further down the page.
   */
  it("carries a cancelled badge beside the hour, not below the fold", () => {
    const { container } = render(
      <VoyageHeader
        back={<a href="/back">Board</a>}
        hour="7:00 AM"
        title="Two-Tank Reef"
        facts={["Mantis I", "9 of 12 seats taken"]}
        badge={<span>Cancelled</span>}
      />,
    );
    expect(container.querySelector("header")?.textContent).toContain("Cancelled");
  });

  it("keeps both of the header's controls on the accent", () => {
    const { container } = render(
      <>
        <EyebrowBackLink href="/shop/blue-mantis/schedule/board">Board</EyebrowBackLink>
        <TripAddDiverLink href="#add-diver" label="Add diver" />
      </>,
    );
    expect(
      container.querySelector('a[href="/shop/blue-mantis/schedule/board"]')?.className,
    ).toContain("text-primary");
    expect(container.querySelector('a[href="#add-diver"]')?.className).toContain("text-primary");
  });
});
