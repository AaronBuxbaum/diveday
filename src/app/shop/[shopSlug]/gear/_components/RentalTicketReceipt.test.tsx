// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { RentalTicketReceipt } from "./RentalTicketReceipt";

afterEach(cleanup);

const t = staffTranslator("en-US");

describe("RentalTicketReceipt", () => {
  it("prints the shop's own terms verbatim, line breaks kept, above the lines to write on", () => {
    const { container } = render(
      <RentalTicketReceipt
        terms={"Rinse everything in fresh water.\nLost gear is charged at cost."}
        t={t}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Rental terms" })).toBeInTheDocument();
    const terms = container.querySelector("[data-rental-terms]");
    expect(terms?.textContent).toBe(
      "Rinse everything in fresh water.\nLost gear is charged at cost.",
    );
    expect(terms?.className).toContain("whitespace-pre-wrap");
    const labels = ["Received by", "Printed name", "Date"].map((label) => screen.getByText(label));
    expect(terms?.compareDocumentPosition(labels[0] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("prints no terms heading when the shop has written none, and still the received-by line", () => {
    render(<RentalTicketReceipt terms={null} t={t} />);
    expect(screen.queryByRole("heading", { name: "Rental terms" })).toBeNull();
    expect(screen.getByText("Received by")).toBeInTheDocument();
    expect(screen.getByText("Printed name")).toBeInTheDocument();
    expect(screen.getByText("Date")).toBeInTheDocument();
  });

  /**
   * A receipt for gear, never a waiver (CR-015): nothing to agree to in
   * DiveDay's words, and no money (billing lives on the order).
   */
  it("says nothing a waiver would, and carries no money", () => {
    const { container } = render(<RentalTicketReceipt terms={null} t={t} />);
    expect(container.textContent).not.toMatch(/agree|waive|release|liab|risk|\$|total|paid/i);
  });
});
