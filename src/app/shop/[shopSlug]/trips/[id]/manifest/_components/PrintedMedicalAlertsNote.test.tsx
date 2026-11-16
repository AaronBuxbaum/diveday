// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { diver } from "./diver-roll-call-test-fixtures";
import { PrintedMedicalAlertsNote } from "./PrintedMedicalAlertsNote";

afterEach(cleanup);

const rows = [
  diver({ bookingId: "a", fullName: "Ana Ruiz" }),
  diver({ bookingId: "b", fullName: "Ben Cole" }),
  diver({ bookingId: "c", fullName: "Cy Dunn" }),
];
const printed = {
  texts: new Map([
    ["a", "x"],
    ["b", "y"],
    ["c", "z"],
  ]),
  printedBy: "Mo",
  printedAt: new Date("2026-12-05T14:00:00Z"),
};

function note(locale: string) {
  return render(
    <PrintedMedicalAlertsNote
      printed={printed}
      divers={rows}
      locale={locale}
      timezone="Europe/Madrid"
      t={staffTranslator(locale)}
    />,
  ).container;
}

describe("PrintedMedicalAlertsNote", () => {
  it("joins the flagged rows with the reader's own conjunction", () => {
    expect(note("en-US")).toHaveTextContent("01 Ana Ruiz, 02 Ben Cole, and 03 Cy Dunn.");
    cleanup();
    expect(note("es-ES")).toHaveTextContent("01 Ana Ruiz, 02 Ben Cole y 03 Cy Dunn.");
  });
});
