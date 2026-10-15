// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripUnitToCheckIn } from "@/db/gear";
import { PrepBackFromBoat } from "./PrepBackFromBoat";
import { t } from "./prep-test-fixtures";

afterEach(cleanup);

const UNITS: TripUnitToCheckIn[] = [
  {
    reservationId: "r1",
    gearItemId: "g1",
    kind: "bcd",
    label: "BCD #21",
    size: "M",
    bookingId: "b1",
    personName: "Nadia Osei",
  },
  {
    reservationId: "r2",
    gearItemId: "g2",
    kind: "regulator",
    label: "Reg #21",
    size: null,
    bookingId: "b1",
    personName: "Nadia Osei",
  },
];

/** Kit comes back by boat, not by date (fifth-loop ideas, item 5). */
describe("PrepBackFromBoat", () => {
  it("counts the units still out and gives each its own row", () => {
    render(<PrepBackFromBoat units={UNITS} tripId="t1" t={t} idPrefix={undefined} />);
    const section = screen.getByRole("region", { name: "Back from the boat" });
    expect(within(section).getByText("2 units to check in")).toBeTruthy();
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("BCD #21");
    expect(rows[0]?.textContent).toContain("Nadia Osei");
    expect(within(section).getAllByRole("button", { name: "Back" })).toHaveLength(2);
    expect(within(section).queryByRole("button", { name: "Fit adjusted" })).toBeNull();
  });

  it("asks what is wrong before a problem saves, and posts the unit it was tapped on", () => {
    const { container } = render(
      <PrepBackFromBoat units={UNITS} tripId="t1" t={t} idPrefix={undefined} />,
    );
    const [first] = screen.getAllByRole("button", { name: "Back with a problem" });
    if (!first) throw new Error("no problem button");
    fireEvent.click(first);
    const note = screen.getByRole("textbox", { name: "What’s wrong with it?" });
    expect(note.hasAttribute("required")).toBe(true);
    const form = note.closest("form");
    expect(form?.querySelector<HTMLInputElement>("input[name=reservationId]")?.value).toBe("r1");
    expect(within(form as HTMLElement).queryByRole("button", { name: "Back" })).toBeNull();
    expect(container.querySelectorAll("input[name=note]")).toHaveLength(1);
  });

  it("says nothing when every unit is home", () => {
    const { container } = render(
      <PrepBackFromBoat units={[]} tripId="t1" t={t} idPrefix={undefined} />,
    );
    expect(container.firstElementChild).toBeNull();
  });
});
