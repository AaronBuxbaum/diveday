// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyFormFields } from "@/components/apply-form-fields";
import { type CallDeparture, TookACallFields } from "./TookACallFields";

afterEach(cleanup);

const copy = {
  outcomeHeading: "What they wanted",
  outcome: {
    "date-request": "A day that isn’t on the board",
    waitlist: "A seat on a full departure",
    booking: "A seat on a departure with room",
  },
  departureLabel: "Which departure",
  departureUnchosen: "Choose a departure",
  noDepartures: "There is nothing on the board to put anyone on.",
  interestLabel: "What they asked about",
  interestPlaceholder: "Two-tank reef in March",
  preferredDateLabel: "Day they want",
  diversLabel: "How many divers",
  noteLabel: "Anything else they said",
  optionalHint: "(optional)",
};

const departures: CallDeparture[] = [
  { id: "11111111-1111-4111-8111-111111111111", label: "Reef morning · 8:00 AM · 4 seats left" },
  { id: "22222222-2222-4222-8222-222222222222", label: "Wreck afternoon · 1:00 PM · full" },
];

function renderInForm(node: React.ReactNode) {
  const { container } = render(<form>{node}</form>);
  const form = container.querySelector("form");
  if (!form) throw new Error("no form rendered");
  return form;
}

/** What this form would actually submit, which is the only thing the action sees. */
function submitted(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of new FormData(form).entries()) out[name] = String(value);
  return out;
}

describe("TookACallFields", () => {
  it("submits nothing but the outcome until one is chosen", () => {
    const form = renderInForm(<TookACallFields copy={copy} departures={departures} />);
    expect(Object.keys(submitted(form))).toEqual([]);
  });

  /**
   * The inactive branches stay in the DOM as `disabled` fieldsets, so what
   * proves the reveal is what the form *submits*, not what is on screen.
   */
  it("submits the departure once a seat is what the caller wanted, and never the request fields", () => {
    const form = renderInForm(<TookACallFields copy={copy} departures={departures} />);
    fireEvent.click(screen.getByLabelText(copy.outcome.booking));
    fireEvent.change(screen.getByLabelText(copy.departureLabel), {
      target: { value: departures[1]?.id },
    });

    expect(submitted(form)).toEqual({
      outcome: "booking",
      tripId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("submits what the caller asked about, and no departure, for a date request", () => {
    const form = renderInForm(<TookACallFields copy={copy} departures={departures} />);
    fireEvent.click(screen.getByLabelText(copy.outcome["date-request"]));
    fireEvent.change(screen.getByLabelText(copy.interestLabel), {
      target: { value: "A night dive in June" },
    });

    const values = submitted(form);
    expect(values.outcome).toBe("date-request");
    expect(values.interest).toBe("A night dive in June");
    expect(values.tripId).toBeUndefined();
  });

  /**
   * **The reason every branch is mounted from the start.** The kept draft is
   * applied once, on mount, over the controls that exist at that moment
   * (`applyFormFields`). Mounted conditionally, a call interrupted halfway
   * would come back with the caller's answers restored and the departure they
   * had already chosen silently gone — a partial restore, which is worse than
   * none because nothing on screen says a field was dropped.
   */
  it("takes a kept draft back in one pass, departure and all", () => {
    const form = renderInForm(<TookACallFields copy={copy} departures={departures} />);
    applyFormFields(form, { outcome: "waitlist", tripId: departures[1]?.id ?? "" });

    expect(submitted(form)).toEqual({
      outcome: "waitlist",
      tripId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("says so rather than offering an empty picker when the board holds nothing", () => {
    renderInForm(<TookACallFields copy={copy} departures={[]} />);
    fireEvent.click(screen.getByLabelText(copy.outcome.waitlist));

    expect(screen.getByText(copy.noDepartures)).toBeTruthy();
    expect(screen.queryByLabelText(copy.departureLabel)).toBeNull();
  });

  it("reopens on the branch a refusal came back from", () => {
    renderInForm(
      <TookACallFields copy={copy} departures={departures} defaultOutcome="date-request" />,
    );
    expect((screen.getByLabelText(copy.outcome["date-request"]) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.getByLabelText(copy.interestLabel)).toBeTruthy();
  });
});
