// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  PrintedKitBlanks,
  PrintedMissingProcedure,
  printedBoatProcedureCopy,
  printedKitRegister,
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

describe("the register's line above the kit blanks (fourth review item 17, review F2)", () => {
  afterEach(cleanup);
  const t = staffTranslator("en-US");
  const record = {
    boatName: "Mantis I",
    oxygenKits: ["O2 Kit A"],
    firstAidKits: ["Trauma bag"],
    oxygenServicedOn: "2026-09-30" as const,
  };

  it("states the register's facts on their own line and leaves every blank a blank", () => {
    // "Kept ___" asks where on the boat; "Last checked ___ · O2 pressure ___"
    // is the pre-trip check. The register answers neither, so it never fills
    // them: it gets a line of its own (review F2).
    const register = printedKitRegister(record, t, "en-US");
    expect(register).toMatch(
      /^Register: O2 Kit A and Trauma bag aboard Mantis I; oxygen kit serviced Sep\s30,\s2026$/,
    );
    render(<PrintedKitBlanks copy={copy} headingId="kit" register={register} />);
    const section = screen.getByRole("region", { name: "Oxygen and first aid" });
    expect(section).toHaveTextContent(/Register: O2 Kit A and Trauma bag aboard Mantis I/);
    const definitions = within(section).getAllByRole("definition");
    expect(definitions).toHaveLength(4);
    for (const value of definitions) {
      expect(value.textContent).toBe("");
      expect(value.querySelector("[data-print-blank]")).not.toBeNull();
    }
  });

  it("leaves the date out when no oxygen kit has a service on record", () => {
    expect(printedKitRegister({ ...record, oxygenServicedOn: null }, t, "en-US")).toBe(
      "Register: O2 Kit A and Trauma bag aboard Mantis I",
    );
  });

  it("prints no register line for a departure on no boat, or a boat with nothing aboard", () => {
    expect(printedKitRegister(null, t, "en-US")).toBeNull();
    expect(
      printedKitRegister(
        { boatName: "Mantis I", oxygenKits: [], firstAidKits: [], oxygenServicedOn: null },
        t,
        "en-US",
      ),
    ).toBeNull();
  });

  it("carries the line in Spanish", () => {
    expect(printedKitRegister(record, staffTranslator("es-ES"), "es-ES")).toMatch(
      /^Registro: O2 Kit A y Trauma bag a bordo de Mantis I; mantenimiento del equipo de oxígeno: 30\s.+2026$/,
    );
  });
});
