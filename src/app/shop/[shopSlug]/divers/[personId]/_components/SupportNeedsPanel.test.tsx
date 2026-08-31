// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { SupportNeeds } from "@/lib/support-needs";
import { SupportNeedsPanel } from "./SupportNeedsPanel";

vi.mock("../actions", () => ({ saveSupportNeedsAction: vi.fn() }));

const t = staffTranslator("en-US");
type PanelStatus = ComponentProps<typeof SupportNeedsPanel>["status"];

const NEEDS: SupportNeeds = {
  supportDiversNeeded: 2,
  supportDiversProvidedBy: "shop",
  needsBoardingAssistance: true,
  needsWaterLift: true,
  briefingInSign: false,
  briefingInWriting: true,
  briefingAloud: false,
  briefingBySignals: false,
  equipmentAdaptation: "webbed gloves",
  divesWithName: "Marisol Vega",
  statedAt: new Date("2026-08-20T10:00:00.000Z"),
};

function renderPanel(overrides: Partial<ComponentProps<typeof SupportNeedsPanel>> = {}) {
  return render(
    <SupportNeedsPanel
      needs={NEEDS}
      shopSlug="blue-mantis"
      personId="person-1"
      canOverride={false}
      t={t}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the diver record's Dive support group", () => {
  it("is closed by default at desktop and keeps the full safety fact set", () => {
    renderPanel();

    const details = screen.getByTestId("diver-file-group-support");
    const summary = details.querySelector("summary");

    expect(details).not.toHaveAttribute("open");
    expect(summary).not.toHaveClass("sm:hidden");
    expect(details.querySelector(".diver-file-group-content")).not.toHaveClass("sm:!block");
    expect(summary).toHaveTextContent(/Dive support\s*6 arrangements/);

    for (const fact of [
      "2 support divers in the water — the shop arranges",
      "Help getting aboard",
      "Lift in and out of the water",
      "Briefing in writing",
      "Equipment: webbed gloves",
      "Dives with Marisol Vega",
    ]) {
      expect(screen.getByText(fact)).toBeInTheDocument();
    }
  });

  it("opens the native group for the #support deep link", async () => {
    window.history.replaceState(null, "", "/#support");
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("diver-file-group-support")).toHaveAttribute("open");
    });
  });

  it("opens on its own save outcome and preserves the editable form names", () => {
    const status: PanelStatus = {
      form: "support",
      tone: "success",
      text: "Dive support saved.",
    };
    renderPanel({ needs: null, canOverride: true, status });

    const details = screen.getByTestId("diver-file-group-support");
    const form = screen.getByRole("button", { name: "Save dive support" }).closest("form");

    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("status")).toHaveTextContent("Dive support saved.");
    expect(form).not.toBeNull();
    for (const name of [
      "supportDiversProvidedBy",
      "supportDiversNeeded",
      "needsBoardingAssistance",
      "needsWaterLift",
      "briefingInSign",
      "briefingInWriting",
      "briefingAloud",
      "briefingBySignals",
      "equipmentAdaptation",
      "divesWithName",
    ]) {
      expect(form?.querySelector(`[name="${name}"]`)).not.toBeNull();
    }
  });
});
