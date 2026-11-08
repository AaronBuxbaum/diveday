// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { CounterRentalUnit } from "../../../../../../../features/gear-counter-rentals/store";
import { TankGas, TankGasCorrections } from "./TankGas";

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
  fillO2CleanGap: null,
  fillRecordedAt: new Date("2026-10-08T12:00:00Z"),
  fillRecordedByName: "Dana Desk",
  ...overrides,
});

/** Domain reviews A3/F6: the ticket says the gas was recorded, not analyzed. */
describe("TankGas", () => {
  it("prints each tank's gas, who recorded it, and that nobody analyzed it, with no control", () => {
    const { container } = render(<TankGas t={t} units={[unit({})]} />);
    expect(screen.getByText("EANx 32", { selector: "span" })).toBeTruthy();
    expect(
      screen.getByText(t("counterRentals.ticket.fillRecordedBy", { name: "Dana Desk" })),
    ).toBeTruthy();
    expect(screen.getByText(t("counterRentals.ticket.fillNotAnalyzed"))).toBeTruthy();
    // It sits on the slip's sheet (issue #2745): the correction is the screen's.
    expect(container.querySelector("form, button, select")).toBeNull();
  });

  it("says beside the gas when EANx went in without a current O2-clean record (issue #3005)", () => {
    render(
      <TankGas
        t={t}
        units={[
          unit({ fillO2CleanGap: "lapsed" }),
          unit({ reservationId: "r2", label: "Tank #2", fillO2CleanGap: "never" }),
          unit({ reservationId: "r3", label: "Tank #3", fillO2Percent: 21 }),
        ]}
      />,
    );
    expect(screen.getByText(t("counterRentals.ticket.fillO2CleanLapsed"))).toBeTruthy();
    expect(screen.getByText(t("counterRentals.ticket.fillO2CleanNever"))).toBeTruthy();
    expect(document.querySelectorAll("[data-o2-clean-gap]")).toHaveLength(2);
  });

  it("says nothing about O2 cleaning on a current or air fill", () => {
    render(<TankGas t={t} units={[unit({}), unit({ fillO2Percent: 21 })]} />);
    expect(document.querySelector("[data-o2-clean-gap]")).toBeNull();
  });

  it("says nothing with no tank", () => {
    const { container } = render(
      <TankGas t={t} units={[unit({ kind: "fins", fillO2Percent: null })]} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("TankGasCorrections", () => {
  it("offers a correction per tank still held or out", () => {
    render(
      <TankGasCorrections
        t={t}
        ticketId="r1"
        units={[unit({}), unit({ reservationId: "r2", label: "Tank #2", returnedAt: new Date() })]}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: t("counterRentals.ticket.fillCorrect") }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("combobox", {
        name: t("counterRentals.ticket.fillCorrectAria", { label: "Tank #1" }),
      }),
    ).toBeTruthy();
  });

  it("offers none once every tank is home, and says nothing with no tank", () => {
    const { container } = render(
      <TankGasCorrections t={t} ticketId="r1" units={[unit({ returnedAt: new Date() })]} />,
    );
    expect(container.textContent).toBe("");
    cleanup();
    const none = render(
      <TankGasCorrections
        t={t}
        ticketId="r1"
        units={[unit({ kind: "fins", fillO2Percent: null })]}
      />,
    );
    expect(none.container.textContent).toBe("");
  });
});
