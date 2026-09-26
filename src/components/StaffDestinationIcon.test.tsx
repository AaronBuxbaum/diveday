// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_DESTINATIONS,
  type StaffDestinationId,
} from "@/lib/staff-destinations";
import { StaffDestinationIcon } from "./StaffDestinationIcon";

afterEach(cleanup);

/**
 * **Every destination a staffer can reach is drawn.** "Took a call" shipped
 * with no artwork, and the neutral dot the docblock promised for that case
 * could never fire, so the command palette drew a glyph on every row but one
 * (pixel-craft K-275). The map is a full record now, so `tsc` refuses a
 * destination without a picture; this pins the rendered half.
 */
describe("the destination icons", () => {
  const ids = [
    ...new Set<StaffDestinationId>([
      ...STAFF_DESTINATIONS.map((destination) => destination.id),
      ...(Object.keys(STAFF_DESTINATION_LABEL_KEYS) as StaffDestinationId[]),
    ]),
  ];

  it.each(ids)("draws %s", (id) => {
    const { container } = render(<StaffDestinationIcon id={id} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path, circle, rect").length).toBeGreaterThan(0);
  });
});
