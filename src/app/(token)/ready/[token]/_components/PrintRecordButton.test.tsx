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

  it("prints the sheet, never the screen, when the browser's own Print is used", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<Page />);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(screen.queryByText("The screen")).toBeNull();
    expect(screen.getByText("Logbook sheet")).toBeInTheDocument();
    // The browser is already printing: nothing asks again.
    expect(print).not.toHaveBeenCalled();
  });

  it("goes back to the screen", () => {
    vi.spyOn(window, "print").mockImplementation(() => {});
    render(<Page />);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to your day" }));
    expect(screen.getByText("The screen")).toBeInTheDocument();
    expect(screen.queryByText("Logbook sheet")).toBeNull();
  });

  it("offers no Print outside a page that has paper", () => {
    render(<PrintRecordButton label="Print log entry" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
