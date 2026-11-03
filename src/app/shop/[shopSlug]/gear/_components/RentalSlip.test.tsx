// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RentalSlip } from "./RentalSlip";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** Anything a person could press, type in or follow. A sheet holds none. */
const CONTROLS = "a, button, input, select, textarea, form, [role='button'], [tabindex]";

function renderSlip(extra?: ReactNode) {
  return render(
    <RentalSlip
      shop={{ name: "Blue Mantis Divers", brandColor: null }}
      shopSlug="blue-mantis"
      printed="Printed Nov 3, 2026 · 9:00 AM EST"
      holder="Priya Sharma"
      line="Nov 3, 2026 – Nov 4, 2026"
      units={[
        { id: "r1", label: "Mask #2", detail: "Mask" },
        { id: "r2", label: "Tank #1", detail: "Tank · EANx 32" },
      ]}
      dueBack="Back by Nov 4, 2026"
      terms={"Rinse everything.\nLost gear is charged at cost."}
      t={t}
      foot="+1 305 555 0100"
    >
      {extra}
    </RentalSlip>,
  );
}

/** Issue #2745: both rental tickets are this one sheet of the shop's paper. */
describe("the rental slip", () => {
  it("is one sheet of the shop's paper, with no control on it", () => {
    const { container } = renderSlip();
    const sheets = container.querySelectorAll(".paper-sheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.querySelectorAll(CONTROLS)).toHaveLength(0);
    // The shop's band and the fold line every sheet carries.
    const band = container.querySelector<HTMLElement>(".paper-sheet-band");
    expect(band && within(band).getByText("Blue Mantis Divers")).toBeTruthy();
    expect(band && within(band).getByText(t("gear.ticket.eyebrow"))).toBeTruthy();
    expect(screen.getByText("Printed Nov 3, 2026 · 9:00 AM EST")).toBeTruthy();
    expect(container.querySelector(".paper-sheet-fold")?.textContent).toContain("/s/blue-mantis");
  });

  it("says who, what and when, then ends on the shared received-by foot", () => {
    renderSlip();
    expect(screen.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeTruthy();
    const units = screen.getByRole("list");
    expect(within(units).getByText("Mask #2")).toBeTruthy();
    expect(within(units).getByText("Tank · EANx 32")).toBeTruthy();
    expect(screen.getByText("Back by Nov 4, 2026")).toBeTruthy();
    expect(screen.getByRole("heading", { name: t("gear.ticket.termsHeading") })).toBeTruthy();
    expect(screen.getByText(t("gear.ticket.receivedBy"))).toBeTruthy();
    expect(screen.getByText("+1 305 555 0100")).toBeTruthy();
  });

  it("keeps what the counter ticket adds inside the same sheet", () => {
    const { container } = renderSlip(<p data-testid="bill">the bill</p>);
    expect(container.querySelector(".paper-sheet [data-testid='bill']")).not.toBeNull();
  });
});
