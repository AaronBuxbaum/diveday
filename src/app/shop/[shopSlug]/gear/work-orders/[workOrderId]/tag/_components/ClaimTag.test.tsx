// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { ShopSheet } from "../../../../../print/_components/ShopSheet";
import { ClaimTag } from "./ClaimTag";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** Anything a person could press, type in or follow. A sheet holds none. */
const CONTROLS = "a, button, input, select, textarea, form, [role='button'], [tabindex]";

function renderTag(overrides: Partial<Parameters<typeof ClaimTag>[0]> = {}) {
  return render(
    <ShopSheet
      paper={PACKET_PAPER}
      shop={{ name: "Blue Mantis Divers", brandColor: null }}
      shopSlug="blue-mantis"
      name={t("workOrders.tag.eyebrow")}
      printed="Printed Nov 3, 2026 · 9:00 AM EST"
    >
      <ClaimTag
        t={t}
        subject="Diego Alvarez"
        number={42}
        receivedOn="Nov 3"
        pieces={[{ id: "p1", name: "Regulator", detail: "Apeks XTX50 · SN 123" }]}
        problem="Breathes wet at depth."
        promised="Nov 10, 2026"
        phone="+1 305 555 0100"
        {...overrides}
      />
    </ShopSheet>,
  );
}

/** ADR 20261008-gear-work-orders; issue #2745: the tag is one sheet of the shop's paper. */
describe("the claim tag", () => {
  it("is one sheet of the shop's paper, with no control on it", () => {
    const { container } = renderTag();
    const sheets = container.querySelectorAll(".paper-sheet");
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.querySelectorAll(CONTROLS)).toHaveLength(0);
    expect(container.querySelector(".paper-sheet-band")?.textContent).toContain(
      t("workOrders.tag.eyebrow"),
    );
  });

  it("says what we have, what you told us, when to come back and who to call", () => {
    renderTag();
    expect(screen.getByRole("heading", { level: 1, name: "Diego Alvarez" })).toBeTruthy();
    expect(screen.getByText(t("workOrders.number", { number: 42 }))).toBeTruthy();
    expect(screen.getByText("Regulator")).toBeTruthy();
    expect(screen.getByText("Breathes wet at depth.")).toBeTruthy();
    expect(screen.getByText(t("workOrders.tag.promised", { date: "Nov 10, 2026" }))).toBeTruthy();
    expect(screen.getByText(t("workOrders.tag.phone", { phone: "+1 305 555 0100" }))).toBeTruthy();
  });

  it("promises nothing nobody promised, and carries no money or signature", () => {
    const { container } = renderTag({ promised: null, phone: null });
    expect(container.textContent).not.toMatch(/Promised|Call |\$|total|sign/i);
  });
});
