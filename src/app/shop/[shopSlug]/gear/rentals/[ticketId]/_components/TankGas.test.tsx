// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CounterRentalUnit } from "@/db/gear-counter-rentals";
import { staffTranslator } from "@/i18n/staff-messages";
import { TankGas } from "./TankGas";

vi.mock("../../actions", () => ({ correctCounterTankFillAction: vi.fn() }));

afterEach(cleanup);

const t = staffTranslator("en-US");

const unit = (overrides: Partial<CounterRentalUnit>): CounterRentalUnit => ({
  reservationId: "r1",
  gearItemId: "g1",
  kind: "tank",
  label: "Tank #1",
  size: null,
  checkedOutAt: null,
  returnedAt: null,
  returnOutcome: null,
  fillO2Percent: 32,
  fillRecordedAt: new Date("2026-10-08T12:00:00Z"),
  fillRecordedByName: "Dana Desk",
  ...overrides,
});

/** Domain reviews A3/F6: the ticket says the gas was recorded, not analyzed. */
describe("TankGas", () => {
  it("prints each tank's gas, who recorded it, and that nobody analyzed it", () => {
    render(<TankGas t={t} ticketId="r1" units={[unit({})]} />);
    expect(screen.getByText("EANx 32", { selector: "span" })).toBeTruthy();
    expect(
      screen.getByText(t("counterRentals.ticket.fillRecordedBy", { name: "Dana Desk" })),
    ).toBeTruthy();
    expect(screen.getByText(t("counterRentals.ticket.fillNotAnalyzed"))).toBeTruthy();
    expect(
      screen.getByRole("button", { name: t("counterRentals.ticket.fillCorrect") }),
    ).toBeTruthy();
  });

  it("offers no correction once the tank is home, and says nothing with no tank", () => {
    render(<TankGas t={t} ticketId="r1" units={[unit({ returnedAt: new Date() })]} />);
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    const { container } = render(
      <TankGas t={t} ticketId="r1" units={[unit({ kind: "fins", fillO2Percent: null })]} />,
    );
    expect(container.textContent).toBe("");
  });
});
