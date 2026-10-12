// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiverRowPrint } from "./DiverRowPrint";
import { boardedAt, diver, renderList, t } from "./diver-roll-call-test-fixtures";
import { diverRowState } from "./diver-row-state";

afterEach(cleanup);

/**
 * **The name prints.** The name is the trigger that opens the person's sheet,
 * so it lives inside a `<button>`, and the packet's print backstop hides every
 * button in `.trip-print-bundle` (`globals.css`). Both packets printed every
 * roll-call row without its name until the trigger declared that its content
 * is the fact (`print-bundle.test.ts` reads the rule). The caret is the one
 * part of it that is only a control, so it stays off paper.
 */
describe("the roll call on paper", () => {
  it("marks the name trigger as content the packet prints, and keeps its caret off paper", () => {
    renderList({ divers: [diver()] });
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    expect(trigger).toHaveAttribute("data-print-content");
    expect(within(trigger).getByText("Meera Iyer")).toBeVisible();
    const caret = trigger.querySelector("svg:last-child");
    expect(caret).not.toBeNull();
    expect(caret).toHaveClass("print:hidden");
  });

  it("prints the name as one line, not at the deck's 76px row", () => {
    // The mark does not print, so its 76px row and 12px inset have nothing to
    // hold on paper; carried there, every name was a 16mm band and a full
    // boat's roll call ran to extra pages (K-02 review).
    renderList({ divers: [diver()] });
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    expect(trigger).toHaveClass("print:min-h-0", "print:py-1");
  });
});

describe("DiverRowPrint, drawn on its own", () => {
  it("is paper only, and dates a recorded state in full with its zone", () => {
    const boarded = diver({ rollCall: boardedAt() });
    const state = diverRowState(boarded, "departure", true);
    const { container } = render(
      <DiverRowPrint
        diver={boarded}
        state={state}
        checkpoint="departure"
        auditLabel="Boarded"
        teamLabel={null}
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block.className).toContain("hidden");
    expect(block.className).toContain("print:block");
    expect(block).toHaveTextContent("Keiko Tanaka");
    expect(block.textContent).toMatch(/EDT/);
  });
});
