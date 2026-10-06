// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  PrintedKitBlanks,
  PrintedMissingProcedure,
  printedBoatProcedureCopy,
} from "./PrintedBoatProcedure";

const copy = printedBoatProcedureCopy(staffTranslator("en-US"));

/**
 * What the laminated boat card used to carry and nothing else printed once it
 * was cut (issue #2035, Aaron's yes on 2026-10-05): the missing-diver
 * procedure, and ruled blanks for where the oxygen and first aid kits are and
 * when they were last checked.
 */
describe("the printed boat procedure", () => {
  afterEach(cleanup);

  it("prints the missing-diver procedure in full", () => {
    render(<PrintedMissingProcedure copy={copy} headingId="missing" />);
    expect(screen.getByRole("heading", { name: "If someone is missing" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Note the time and mark the position. Do not leave the site. Call the roll again by name. Then call for help on the numbers below, and call the shop.",
      ),
    ).toBeInTheDocument();
  });

  it("prints the oxygen and first aid lines as blanks to fill by hand, never a value", () => {
    // DiveDay holds none of these facts, and a value it invented would be worse
    // than a blank (issue #688): the crew who trusts it spends the minute
    // finding out.
    render(<PrintedKitBlanks copy={copy} headingId="kit" />);
    const section = screen.getByRole("region", { name: "Oxygen and first aid" });
    const terms = within(section)
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(terms).toEqual(["Oxygen, where", "First aid kit, where", "Last checked"]);
    for (const value of within(section).getAllByRole("definition")) {
      expect(value.textContent).toBe("");
      expect(value.querySelector("[data-print-blank]")).not.toBeNull();
    }
  });

  it("carries both in Spanish", () => {
    const es = printedBoatProcedureCopy(staffTranslator("es-ES"));
    render(
      <>
        <PrintedMissingProcedure copy={es} headingId="missing" />
        <PrintedKitBlanks copy={es} headingId="kit" />
      </>,
    );
    expect(screen.getByRole("heading", { name: "Si falta alguien" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Oxígeno y primeros auxilios" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Botiquín, dónde")).toBeInTheDocument();
  });
});
