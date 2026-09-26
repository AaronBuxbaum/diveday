// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { joinFacts } from "@/lib/format";
import { TripPickerList } from "./TripPickerList";

afterEach(cleanup);

const OPTIONS = [
  {
    id: "reef",
    href: "/shop/blue-mantis/check-in/walk-in/reef",
    title: "Two-Tank Reef — Molasses & French",
    when: "11:00 AM – 2:30 PM",
    meta: "3/12",
  },
  {
    id: "wreck",
    href: "/shop/blue-mantis/check-in/walk-in/wreck",
    title: "Wreck Trip — Spiegel Grove",
    when: "1:00 PM – 5:30 PM",
    meta: "8/10",
  },
];

describe("the walk-in's departure picker", () => {
  it("makes every departure a door, named for it, with its seats beside it", () => {
    render(<TripPickerList options={OPTIONS} />);
    const reef = screen.getByRole("link", { name: /Two-Tank Reef/ });
    expect(reef).toHaveAttribute("href", "/shop/blue-mantis/check-in/walk-in/reef");
    expect(reef).toHaveTextContent("3/12");
  });

  /**
   * **A title and its time are a row's facts, joined the app's one way**
   * (pixel-craft class 8, K-525). They were joined " · " with a breaking space
   * before the dot, so at 390 a long title wrapped and the second line opened
   * on the separator. `joinFacts` (`src/lib/format.ts`) binds the dot to the
   * word before it, so no line starts with "·", and binds the last fact to
   * the one before it, so no line ends on "·" with the time alone under it.
   */
  it("joins each title and time as a row's facts, never breaking at the dot", () => {
    render(<TripPickerList options={OPTIONS} />);
    const links = screen.getAllByRole("link");
    for (const [index, link] of links.entries()) {
      const option = OPTIONS[index];
      // Raw `textContent`: jest-dom's `toHaveTextContent` folds U+00A0 into a
      // plain space, which is the one difference this asserts.
      const text = link.textContent ?? "";
      expect(text).toBe(`${joinFacts([option.title, option.when])}${option.meta}`);
      const dots = [...text.matchAll(/(.)·(.)/g)];
      expect(dots, text).toHaveLength(1);
      for (const [, before, after] of dots) {
        expect(before, `the space before the dot in "${text}"`).toBe("\u00A0");
        expect(after, `the space after the dot in "${text}"`).toBe("\u00A0");
      }
    }
  });
});
