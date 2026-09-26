// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TONE_PANEL_CLASS, TONE_PANEL_IN_OVERLAY_CLASS } from "@/components/ui/card";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import { EmergencyReferenceCard } from "./EmergencyReferenceCard";

const copy = {
  heading: "In an emergency",
  // The shipped words (`manifest.emergency.empty`): a fact, with no errand.
  empty: "No emergency numbers recorded for this shop.",
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

  it("states the absence and asks for nothing", () => {
    render(<EmergencyReferenceCard copy={copy} reference={EMPTY_EMERGENCY_REFERENCE} />);

    // The panel is still there — a crew that finds no card cannot tell the
    // difference between "nothing recorded" and "this build lost the feature".
    expect(screen.getByRole("heading", { name: "In an emergency" })).toBeInTheDocument();
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    // And nothing to tap. This reader is offshore, with no signal and usually
    // no permission to open Settings, so an errand here is a job they cannot
    // do; it lives on the Settings hub, beside the form that ends it.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("wears the same chrome empty as it does full", () => {
    // The tint is the card's identity on a wet screen in glare, not an alarm
    // that fires on a condition — the crew finds the red box before reading a
    // word of it. A panel that went neutral exactly when there is nothing
    // under it is the one a crew skims past.
    const empty = render(
      <EmergencyReferenceCard copy={copy} reference={EMPTY_EMERGENCY_REFERENCE} />,
    );
    const full = render(
      <EmergencyReferenceCard
        copy={copy}
        reference={{ ...EMPTY_EMERGENCY_REFERENCE, lines: [{ label: "Chamber", phone: "VHF 16" }] }}
      />,
    );

    const emptyClass = empty.container.querySelector("section")?.className;
    expect(emptyClass).toBe(full.container.querySelector("section")?.className);
    expect(emptyClass).toContain("border-danger/40");
  });

  /**
   * **On the bed at rest, on its overlay's lift inside one.** At rest — the
   * offline copy, the desktop footer — the card is a card in a tone and stands
   * on the bed like one. Inside the manifest's phone menu a popover already
   * lifts it: ADR 20260901-diveday-reimagined gives the bed to a panel at rest
   * only, and there the bed's blur smeared past the popover's edge in dark
   * mode. The tone, the words and the padding are the same either way.
   */
  it("stands on the bed at rest, and on its overlay's own lift inside one", () => {
    const resting = render(
      <EmergencyReferenceCard copy={copy} reference={EMPTY_EMERGENCY_REFERENCE} />,
    );
    const carried = render(
      <EmergencyReferenceCard
        copy={copy}
        reference={EMPTY_EMERGENCY_REFERENCE}
        headingId="emergency-reference-in-menu"
        inOverlay
      />,
    );

    const atRest = resting.container.querySelector("section");
    expect(atRest).toHaveClass(...TONE_PANEL_CLASS.split(" "), "border-danger/40", "bg-danger/5");
    const inMenu = carried.container.querySelector("section");
    expect(inMenu).toHaveClass(
      ...TONE_PANEL_IN_OVERLAY_CLASS.split(" "),
      "border-danger/40",
      "bg-danger/5",
    );
    expect(inMenu).not.toHaveClass("shadow-bed");
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

  // K-594: the Spanish vessel line ended on one word at 390.
  it("wraps the vessel and shore-contact lines without a one-word last line", () => {
    render(
      <EmergencyReferenceCard
        copy={copy}
        reference={{
          ...EMPTY_EMERGENCY_REFERENCE,
          vessel: "Mantis II, moored at the fuel dock",
          shoreContact: "Front desk until 18:00",
        }}
      />,
    );

    expect(screen.getByText("Vessel:").parentElement).toHaveClass("text-pretty");
    expect(screen.getByText("Shore contact:").parentElement).toHaveClass("text-pretty");
  });
});
