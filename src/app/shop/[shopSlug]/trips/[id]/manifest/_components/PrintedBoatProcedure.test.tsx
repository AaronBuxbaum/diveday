// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  PrintedKitBlanks,
  PrintedMissingProcedure,
  printedBoatProcedureCopy,
  printedKitValues,
} from "./PrintedBoatProcedure";

const copy = printedBoatProcedureCopy(staffTranslator("en-US"));

/**
 * What the laminated boat card used to carry and nothing else printed once it
 * was cut (issue #2035, Aaron's yes on 2026-10-05): the missing-diver
 * procedure, and ruled blanks for where the oxygen and first aid kits are
 * kept, when they were last checked, and the oxygen pressure at that check.
 */
describe("the printed boat procedure", () => {
  afterEach(cleanup);

  it("prints the missing-diver procedure in full", () => {
    render(<PrintedMissingProcedure copy={copy} headingId="missing" />);
    expect(screen.getByRole("heading", { name: "If someone is missing" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Note the time and mark the position. Do not leave the site. Call the roll again by name. Sound the recall and search the surface, downcurrent first. Call for help on VHF channel 16 without waiting, then on the numbers below, and call the shop.",
      ),
    ).toBeInTheDocument();
  });

  it("puts the surface search and the radio before any printed number", () => {
    // The shop's own numbers may not be printed at all (dive-domain review):
    // the steps that need no number come first, in both languages.
    for (const locale of ["en-US", "es-ES"] as const) {
      const text = printedBoatProcedureCopy(staffTranslator(locale)).missing;
      const radio = text.indexOf("16");
      const numbersBelow =
        locale === "en-US" ? text.indexOf("numbers below") : text.indexOf("números de abajo");
      expect([locale, radio]).not.toEqual([locale, -1]);
      expect([locale, radio < numbersBelow]).toEqual([locale, true]);
    }
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
    expect(terms).toEqual([
      "Oxygen kit is kept",
      "First aid kit is kept",
      "Last checked",
      "O2 pressure",
    ]);
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
    expect(screen.getByText("El botiquín se guarda en")).toBeInTheDocument();
    expect(screen.getByText("Presión del O2")).toBeInTheDocument();
  });
});

describe("the kit lines filled from the shop's register (fourth review, item 17)", () => {
  afterEach(cleanup);
  const t = staffTranslator("en-US");

  it("prints what the register holds and keeps a blank for the rest", () => {
    const values = printedKitValues(
      {
        boatName: "Mantis I",
        oxygenKits: ["O2 Kit A"],
        firstAidKits: [],
        oxygenLastCheckedOn: "2026-09-30",
      },
      t,
      "en-US",
    );
    expect(values).toEqual({
      oxygenKept: "aboard Mantis I (O2 Kit A)",
      firstAidKept: null,
      lastChecked: expect.stringMatching(/Sep\s30,\s2026/),
    });
    render(<PrintedKitBlanks copy={copy} headingId="kit" values={values} />);
    const section = screen.getByRole("region", { name: "Oxygen and first aid" });
    const definitions = within(section).getAllByRole("definition");
    expect(definitions[0]).toHaveTextContent("aboard Mantis I (O2 Kit A)");
    // First aid, and the oxygen pressure the register never holds, stay blanks.
    expect(definitions[1]?.querySelector("[data-print-blank]")).not.toBeNull();
    expect(definitions[3]?.querySelector("[data-print-blank]")).not.toBeNull();
  });

  it("is all blanks for a departure on no boat", () => {
    expect(printedKitValues(null, t, "en-US")).toEqual({
      oxygenKept: null,
      firstAidKept: null,
      lastChecked: null,
    });
  });
});
