// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintRecordButton } from "./PrintRecordButton";
import { RecordPaper } from "./RecordPaper";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Page() {
  return (
    <RecordPaper
      sheet={<section className="paper-sheet">Logbook sheet</section>}
      backLabel="Back to your day"
      printLabel="Print log entry"
    >
      <main>
        <p>The screen</p>
        <PrintRecordButton label="Print log entry" />
      </main>
    </RecordPaper>
  );
}

describe("the record's paper (issue #2745)", () => {
  it("swaps the screen for the sheet and opens the dialog on it", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((step) => {
      step(0);
      return 0;
    });
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Print log entry" }));
    expect(screen.queryByText("The screen")).toBeNull();
    expect(screen.getByText("Logbook sheet")).toBeInTheDocument();
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it("keeps the sheet under the screen for the printer alone, beforeprint or not", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { container } = render(<Page />);
    expect(screen.getByText("The screen")).toBeInTheDocument();
    const frame = container.querySelector(".paper-sheet-frame");
    expect(frame?.hasAttribute("data-paper-print-only")).toBe(true);
    expect(frame?.textContent).toBe("Logbook sheet");
    // The browser is already printing: nothing asks again, and nothing swaps.
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(screen.getByText("The screen")).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
  });

  it("goes back to the screen", async () => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((step) => {
      step(0);
      return 0;
    });
    const { container } = render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Print log entry" }));
    expect(container.querySelector("[data-paper-print-only]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to your day" }));
    expect(screen.getByText("The screen")).toBeInTheDocument();
    expect(
      container.querySelector(".paper-sheet-frame")?.hasAttribute("data-paper-print-only"),
    ).toBe(true);
  });

  it("offers no Print outside a page that has paper", () => {
    render(<PrintRecordButton label="Print log entry" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
