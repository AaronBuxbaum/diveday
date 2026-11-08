// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiverRollCall } from "./DiverRollCall";
import { DiverRowPrint } from "./DiverRowPrint";
import { boardedAt, diver, diverContext, t } from "./diver-roll-call-test-fixtures";
import { diverRowState } from "./diver-row-state";

afterEach(cleanup);

/**
 * **On a sheet the name is a line of ink.** The screen's name is the trigger
 * that opens the person's sheet; the paper's is the same words with nothing
 * behind them, at the name's own height rather than the deck's 76px row, so a
 * full boat's roll call takes no extra pages (K-02 review).
 */
describe("the roll call on paper", () => {
  it("draws the name as a line, not a button, at its own height", () => {
    const { container } = render(
      <DiverRollCall context={diverContext({ divers: [diver()], paper: true })} />,
    );
    expect(container.querySelector("button")).toBeNull();
    const name = within(container).getByText("Meera Iyer");
    const line = name.closest("li > div > div") as HTMLElement;
    expect(line).toHaveClass("py-1");
    expect(line.className).not.toMatch(/min-h-/);
  });
});

describe("DiverRowPrint, drawn on its own", () => {
  it("dates a recorded state in full with its zone", () => {
    const boarded = diver({ rollCall: boardedAt() });
    const state = diverRowState(boarded, "departure", true, "America/New_York");
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
    expect(block.className).not.toContain("hidden");
    expect(block).toHaveTextContent("Keiko Tanaka");
    expect(block.textContent).toMatch(/EDT/);
  });
});

describe("a printed medical alert is critical on paper", () => {
  // `.claude/rules/print-ink.md`: a medical alert is critical, so it wears
  // the 2px outline whether the sheet prints the flag or the diver's words
  // (dive-domain review of #2745, finding 1).
  it.each([
    ["the flag", undefined],
    ["the words", "Bee-sting allergy."],
  ])("outlines %s", (_, printedAlert) => {
    const alerted = diver({ medicalAlert: true });
    const state = diverRowState(alerted, "departure", true, "America/New_York");
    const { container } = render(
      <DiverRowPrint
        diver={alerted}
        printedAlert={printedAlert}
        state={state}
        checkpoint="departure"
        auditLabel="To call"
        teamLabel={null}
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );
    const outlined = container.querySelector("[data-print-critical]");
    expect(outlined).not.toBeNull();
    if (printedAlert) expect(outlined).toHaveTextContent(printedAlert);
  });
});
