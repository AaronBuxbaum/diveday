// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GearReturnPane } from "./GearReturnPane";

afterEach(cleanup);

const LABELS = {
  allGood: "All good",
  fitAdjusted: "Fit adjusted",
  serviceConcern: "Service concern",
  cancelConcern: "Cancel",
  noteLabel: "What to tell the technician",
  notePlaceholder: "Torn strap",
};

const BENCH = {
  legend: "Pull for service",
  units: [
    { id: "11111111-1111-4111-8111-111111111111", label: "Reg #4" },
    { id: "22222222-2222-4222-8222-222222222222", label: "BCD #9" },
  ],
};

function renderPane(bench?: typeof BENCH) {
  render(
    <GearReturnPane
      fields={{ tripId: "t1", bookingId: "b1" }}
      action={async () => {}}
      labels={LABELS}
      bench={bench}
    />,
  );
}

/**
 * **Pull it to the bench, only on a concern and never by default** (issue
 * #2205). The fast answers ask nothing more; the concern offers one unticked
 * box per unit, so a scratched mask does not take the regulator off the wall.
 */
describe("GearReturnPane's bench offer", () => {
  it("offers nothing until the concern is open", () => {
    renderPane(BENCH);
    expect(screen.queryByRole("group", { name: "Pull for service" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("offers one unticked box per unit once the concern is open", () => {
    renderPane(BENCH);
    fireEvent.click(screen.getByRole("button", { name: "Service concern" }));
    expect(screen.getByRole("group", { name: "Pull for service" })).toBeTruthy();
    const reg = screen.getByRole("checkbox", { name: "Reg #4" }) as HTMLInputElement;
    const bcd = screen.getByRole("checkbox", { name: "BCD #9" }) as HTMLInputElement;
    expect(reg.checked).toBe(false);
    expect(bcd.checked).toBe(false);
    expect(reg.name).toBe("pull");
    expect(reg.value).toBe(BENCH.units[0]?.id);
  });

  it("posts only the ticked unit", () => {
    renderPane(BENCH);
    fireEvent.click(screen.getByRole("button", { name: "Service concern" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Reg #4" }));
    const form = screen.getByRole("checkbox", { name: "Reg #4" }).closest("form");
    if (!form) throw new Error("pane has no form");
    expect(new FormData(form).getAll("pull")).toEqual([BENCH.units[0]?.id]);
  });

  it("asks nothing extra where no bench is offered", () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Service concern" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

/**
 * **An open concern is the only answer on offer** (dive-domain review): a tap
 * on "All good" with the concern open used to post the set as fine and throw
 * away the typed note and every tick.
 */
describe("GearReturnPane's open concern", () => {
  it("hides the fast answers while the concern is open", () => {
    renderPane(BENCH);
    expect(screen.getByRole("button", { name: "All good" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Service concern" }));
    expect(screen.queryByRole("button", { name: "All good" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fit adjusted" })).toBeNull();
    // The only submit left is the concern itself.
    const submits = screen
      .getAllByRole("button")
      .filter((button) => (button as HTMLButtonElement).type === "submit");
    expect(submits.map((button) => button.textContent)).toEqual(["Service concern"]);
  });

  it("brings the fast answers back on Cancel, with the note and ticks gone", () => {
    renderPane(BENCH);
    fireEvent.click(screen.getByRole("button", { name: "Service concern" }));
    expect(document.activeElement).toBe(screen.getByLabelText("What to tell the technician"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Reg #4" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "All good" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("What to tell the technician")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Service concern" }));
  });
});
