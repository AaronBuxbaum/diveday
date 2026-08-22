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
  it("dials the numbers that can be dialled and prints the ones that cannot", () => {
    render(
      <EmergencyReferenceCard
        copy={copy}
        reference={{
          lines: [
            { label: "Chamber", phone: "+1 305 555 0177" },
            // A radio channel is not a phone number. It belongs on this card
            // and must still render — as text, because a `tel:` to it dials
            // nothing, and a crew tapping a dead link loses the only seconds
            // this card exists to save.
            { label: "Radio", phone: "VHF 16" },
          ],
          vessel: "Mantis II",
          shoreContact: "Front desk",
          plan: "Give O2.\nThen call.",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "+1 305 555 0177" })).toHaveAttribute(
      "href",
      "tel:+13055550177",
    );
    expect(screen.queryByRole("link", { name: "VHF 16" })).toBeNull();
    expect(screen.getByText("VHF 16")).toBeInTheDocument();
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
