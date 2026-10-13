// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CheckpointSwitch } from "./CheckpointSwitch";
import { t } from "./diver-roll-call-test-fixtures";

afterEach(cleanup);

describe("CheckpointSwitch", () => {
  it("links every checkpoint on this departure and marks the open one", () => {
    render(
      <CheckpointSwitch
        checkpoints={["departure", "after_dive_1"]}
        checkpoint="after_dive_1"
        shopSlug="blue-mantis"
        tripId="trip-1"
        t={t}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=departure",
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_1",
    ]);
    expect(links[1]).toHaveAttribute("aria-current", "true");
  });
});
