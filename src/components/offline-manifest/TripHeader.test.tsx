// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { controls, view } from "./section-fixtures";
import { OfflineTripHeader } from "./TripHeader";

afterEach(cleanup);

describe("OfflineTripHeader", () => {
  it("draws the header with the departure's title", () => {
    const { container } = render(<OfflineTripHeader view={view()} controls={controls()} />);
    expect(container.textContent).toContain("Two-Tank Reef");
  });
});
