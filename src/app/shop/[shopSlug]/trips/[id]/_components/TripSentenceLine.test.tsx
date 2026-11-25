// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TripSentenceLine } from "./TripSentenceLine";

afterEach(cleanup);

const sentence = { headline: "2 seats to fill.", emphasis: null, sub: "4 of 6 booked" };

describe("TripSentenceLine's seat bar", () => {
  it("draws one block a seat, the booked ones filled", () => {
    const { container } = render(
      <TripSentenceLine sentence={sentence} rollCall={null} seats={{ booked: 4, capacity: 6 }} />,
    );
    const bar = container.querySelector("[data-seat-bar]");
    expect(bar?.querySelectorAll("[data-seat]")).toHaveLength(6);
    expect(bar?.querySelectorAll('[data-seat="booked"]')).toHaveLength(4);
  });

  it("never draws more filled blocks than seats when a boat is overbooked", () => {
    const { container } = render(
      <TripSentenceLine sentence={sentence} rollCall={null} seats={{ booked: 8, capacity: 6 }} />,
    );
    expect(container.querySelectorAll('[data-seat="booked"]')).toHaveLength(6);
  });

  it("draws no bar without seats", () => {
    const { container } = render(<TripSentenceLine sentence={sentence} rollCall={null} />);
    expect(container.querySelector("[data-seat-bar]")).toBeNull();
  });
});

describe("TripSentenceLine's one door", () => {
  it("draws Filling's primary beside the sentence, to where it is told", () => {
    const { getByRole } = render(
      <TripSentenceLine
        sentence={sentence}
        rollCall={null}
        action={{ href: "/trip?phase=filling&add=1#add-a-booking", label: "Add a guest" }}
      />,
    );
    expect(getByRole("link", { name: "Add a guest" })).toHaveAttribute(
      "href",
      "/trip?phase=filling&add=1#add-a-booking",
    );
  });

  it("draws none when the phase has none", () => {
    const { queryByRole } = render(<TripSentenceLine sentence={sentence} rollCall={null} />);
    expect(queryByRole("link")).toBeNull();
  });
});
