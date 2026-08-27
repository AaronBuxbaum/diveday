// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import { EmergencyReferenceCard } from "./EmergencyReferenceCard";

const copy = {
  heading: "In an emergency",
  empty: "No emergency numbers recorded yet. Add them in Settings.",
  vesselLabel: "Vessel:",
  shoreContactLabel: "Shore contact:",
  planLabel: "First moves",
};

afterEach(cleanup);

describe("EmergencyReferenceCard", () => {
  it("renders every number as reference text — nothing here can place a call", () => {
    const { container } = render(
      <EmergencyReferenceCard
        copy={copy}
        reference={{
          lines: [
            { label: "Chamber", phone: "+1 305 555 0177" },
            // A radio channel is not a phone number, and belongs on this card
            // exactly as much as the chamber's line does.
            { label: "Radio", phone: "VHF 16" },
          ],
          vessel: "Mantis II",
          shoreContact: "Front desk",
          plan: "Give O2.\nThen call.",
        }}
      />,
    );

    // **No call buttons anywhere on the boat** (ADR
    // 20260827-the-departure-is-two-working-surfaces, decision 3). This card
    // renders on the live manifest, the offline copy and the printed packet —
    // every one of them a boat surface or paper. A dialable number here spends
    // permanent mis-tap risk on a path used less than once a year, and an
    // accidental call is strictly worse than a slow one.
    expect(screen.getByText("+1 305 555 0177")).toBeInTheDocument();
    expect(screen.getByText("VHF 16")).toBeInTheDocument();
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("says so when the shop has recorded nothing, rather than rendering an empty box", () => {
    render(<EmergencyReferenceCard copy={copy} reference={EMPTY_EMERGENCY_REFERENCE} />);

    // The panel is still there — a crew that finds no card cannot tell the
    // difference between "nothing recorded" and "this build lost the feature".
    expect(screen.getByRole("heading", { name: "In an emergency" })).toBeInTheDocument();
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it("keeps the plan's own line breaks", () => {
    render(
      <EmergencyReferenceCard
        copy={copy}
        reference={{ ...EMPTY_EMERGENCY_REFERENCE, plan: "Give O2.\nThen call." }}
      />,
    );

    expect(screen.getByText(/Give O2/)).toHaveClass("whitespace-pre-line");
  });
});
