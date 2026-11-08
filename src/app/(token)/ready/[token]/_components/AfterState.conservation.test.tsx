// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AfterState } from "./AfterState";
import { props } from "./after-state-test-fixtures";

vi.mock("./DiveRecordSheet", () => ({ DiveRecordSheet: () => null }));
afterEach(cleanup);

describe("shop-attributed conservation in the recap", () => {
  it("renders no conservation claim without recorded facts", () => {
    render(<AfterState context={props({ conservation: [] })} />);
    expect(screen.queryByRole("region", { name: "recap.conservation.heading" })).toBeNull();
  });

  it("shows only the measured quantity, location, shop attribution and shop's note", () => {
    render(
      <AfterState
        context={props({
          conservation: [
            {
              id: "cleanup",
              kind: "litter_kg",
              quantity: 1.8,
              location: "Molasses Reef",
              note: "Discarded fishing gear",
            },
          ],
        })}
      />,
    );
    const section = screen.getByRole("region", { name: "recap.conservation.heading" });
    expect(
      within(section).getByText("recap.conservation.byShop(Blue Mantis Divers)"),
    ).toBeVisible();
    expect(within(section).getByText(/recap.conservation.litter_kg\(1.8\)/)).toBeVisible();
    expect(within(section).getByText("Discarded fishing gear")).toBeVisible();
    expect(within(section).queryByRole("button")).toBeNull();
  });
});
