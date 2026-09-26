// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FollowShareRow } from "./FollowShareRow";

afterEach(cleanup);

describe("FollowShareRow", () => {
  /**
   * **"Share" is a 44px target both ways** (K-159). The button had a height
   * floor and no width floor, and the one word measured 42.98 × 44 on every
   * /ready capture. The label centres in the floor, so a longer answer
   * ("Link copied") grows the box and a short one never shrinks it.
   */
  it("gives the share button a 44px floor across as well as down", () => {
    render(
      <FollowShareRow
        url="https://example.test/s/blue-mantis/boats/mantis-ii"
        text="Mantis II's day"
        heading="Share with whoever is waiting for you"
        detail="A link to where the boat is, no names on it."
        action="Share"
        copied="Link copied"
        copyFailed="Could not copy"
      />,
    );
    expect(screen.getByRole("button", { name: "Share" })).toHaveClass(
      "min-h-11",
      "min-w-11",
      "justify-center",
    );
  });
});
