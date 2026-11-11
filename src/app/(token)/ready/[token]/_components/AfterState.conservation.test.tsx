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

  it.each(["litter_kg", "lionfish_count"] as const)(
    "shows only measured facts and shop attribution for %s",
    (kind) => {
      render(
        <AfterState
          context={props({
            conservation: [
              {
                id: "cleanup",
                kind,
                quantity: 3,
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
      expect(
        within(section).getByText(`recap.conservation.${kind}(3) · Molasses Reef`),
      ).toBeVisible();
      expect(within(section).getByText("Discarded fishing gear")).toBeVisible();
      expect(within(section).queryByRole("button")).toBeNull();
    },
  );
});
