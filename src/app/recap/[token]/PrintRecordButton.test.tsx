// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintRecordButton } from "./PrintRecordButton";

afterEach(() => {
  cleanup();
});

describe("PrintRecordButton", () => {
  it("triggers window.print when clicked", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(<PrintRecordButton label="Print log entry" />);
    const button = screen.getByRole("button", { name: /Print log entry/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(printSpy).toHaveBeenCalledTimes(1);

    printSpy.mockRestore();
  });
});
