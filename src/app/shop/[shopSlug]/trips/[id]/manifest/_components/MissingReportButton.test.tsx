// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOUCH_REFUSED_ATTRIBUTE } from "@/components/roll-call-touch-guard";
import { type MissingReportAction, MissingReportButton } from "./MissingReportButton";

function touch(type: "pointerDown" | "pointerUp", pointerId: number) {
  fireEvent[type](document, { pointerId, pointerType: "touch" });
}

afterEach(() => {
  touch("pointerUp", 1);
  touch("pointerUp", 2);
  // A key press starts a fresh gesture, so one test's two fingers never refuse the next tap.
  fireEvent.keyDown(document);
  vi.restoreAllMocks();
  cleanup();
});

const offline = {
  label: "No signal: phone the owners or use VHF",
  failed: "The alert did not send. Phone the owners now.",
  copy: { online: "Online", onlineTitle: "Online", offlineTitle: "Offline" },
};

function renderAlert(action: MissingReportAction) {
  render(
    <MissingReportButton
      action={action}
      subject={{ field: "bookingId", id: "seat-1" }}
      checkpoint="after_dive_1"
      label="Missing diver, alert owners now"
      pendingLabel="Alerting…"
      ariaLabel="Missing diver, alert owners now — Ana Ortiz"
      variant="danger"
      offline={offline}
    />,
  );
  return screen.getByRole("button", { name: "Missing diver, alert owners now — Ana Ortiz" });
}

function renderButton(action: MissingReportAction) {
  render(
    <MissingReportButton
      action={action}
      subject={{ field: "personId", id: "crew-1" }}
      checkpoint="after_dive_2"
      label="Start a missing diver report"
      pendingLabel="Opening…"
      ariaLabel="Start a missing diver report — Ana Ortiz"
    />,
  );
  return screen.getByRole("button", { name: "Start a missing diver report — Ana Ortiz" });
}

/**
 * Domain review 2026-10-16: the plain form this replaced swapped the manifest
 * for an error page on a thrown write, and took a palm on wet glass as a tap.
 */
describe("the missing diver report button", () => {
  it("says in words, beside the button, why nothing opened", async () => {
    const action = vi.fn<MissingReportAction>(async () => ({
      message: "Already started by Sal Rivera.",
    }));
    fireEvent.click(renderButton(action));
    expect(await screen.findByRole("alert")).toHaveTextContent("Already started by Sal Rivera.");
    const form = action.mock.calls[0]?.[1];
    expect(form?.get("personId")).toBe("crew-1");
    expect(form?.get("checkpoint")).toBe("after_dive_2");
  });

  it("submits nothing for a press made under two fingers, and marks the button", async () => {
    const action = vi.fn<MissingReportAction>(async () => null);
    const button = renderButton(action);
    touch("pointerDown", 1);
    touch("pointerDown", 2);
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute(TOUCH_REFUSED_ATTRIBUTE)).toBe(true));
    expect(action).not.toHaveBeenCalled();
  });

  it("says to phone the owners or use VHF while the device has no signal (review 2026-10-17)", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderAlert(vi.fn<MissingReportAction>(async () => null));
    expect(await screen.findByText(offline.label)).toBeInTheDocument();
  });

  it("says the alert failed when the request never reached the server", async () => {
    const action = vi.fn<MissingReportAction>(async () => {
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(renderAlert(action));
    expect(await screen.findByRole("alert")).toHaveTextContent(offline.failed);
  });
});
