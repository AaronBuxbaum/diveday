// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoveSeatControl } from "./MoveSeatControl";

afterEach(cleanup);
const copy = {
  trigger: "Move to another departure",
  label: "Departure",
  note: "Same kind of departure",
  choose: "Choose a departure",
  pending: "Moving",
  submit: "Move",
  cancel: "Never mind",
};
const targets = [
  {
    id: "morning",
    label: "Reef",
    startsAt: "2026-10-27T12:00:00Z",
    localDay: "2026-10-27",
    dayLabel: "Oct 27",
    timeLabel: "8:00 AM EDT",
    seatsLeft: 2,
    availability: "2 seats left",
  },
  {
    id: "full",
    label: "Reef",
    startsAt: "2026-10-27T16:00:00Z",
    localDay: "2026-10-27",
    dayLabel: "Oct 27",
    timeLabel: "12:00 PM EDT",
    seatsLeft: 0,
    availability: "Full",
  },
  {
    id: "next-day",
    label: "Reef",
    startsAt: "2026-10-28T12:00:00Z",
    localDay: "2026-10-28",
    dayLabel: "Oct 28",
    timeLabel: "8:00 AM EDT",
    seatsLeft: 2,
    availability: "2 seats left",
  },
];
function setup() {
  render(<MoveSeatControl bookingId="guest" targets={targets} action={vi.fn()} copy={copy} />);
  const trigger = screen.getByText(copy.trigger);
  const details = trigger.closest("details");
  if (!details) throw new Error("missing move disclosure");
  details.open = true;
  return { trigger, details };
}
describe("deliberate seat destinations", () => {
  it("retains the actual day in a selected option after its optgroup closes", () => {
    setup();
    const select = screen.getByLabelText(copy.label);
    fireEvent.change(select, { target: { value: "next-day" } });
    const chosen = screen.getByRole("option", { selected: true });
    expect(chosen).toHaveTextContent("Oct 28");
    expect(chosen).toHaveTextContent("8:00 AM EDT");
    expect(chosen).toHaveTextContent("Reef");
  });

  it("requires an explicit usable choice and exposes full trips without selecting one", () => {
    setup();
    const select = screen.getByLabelText(copy.label);
    expect(select).toHaveValue("");
    expect(select).toBeRequired();
    expect(screen.getByRole("button", { name: copy.submit })).toBeDisabled();
    expect(screen.getByRole("option", { name: /12:00 PM EDT.*Full/ })).toBeDisabled();
    expect(within(select).getAllByRole("group", { name: "Oct 27" })).toHaveLength(1);
    fireEvent.change(select, { target: { value: "morning" } });
    expect(screen.getByRole("button", { name: copy.submit })).toBeEnabled();
  });
  it("reopens the actual move with its server refusal and no preselected retry", () => {
    render(
      <MoveSeatControl
        bookingId="guest"
        targets={targets}
        action={vi.fn()}
        copy={copy}
        refusal="Destination is now full"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Destination is now full");
    expect(screen.getByLabelText(copy.label)).toHaveValue("");
    expect(screen.getByRole("button", { name: copy.submit })).toBeDisabled();
  });
  it("cancels the choice, closes the move and returns focus to its trigger", () => {
    const { trigger, details } = setup();
    fireEvent.change(screen.getByLabelText(copy.label), { target: { value: "morning" } });
    fireEvent.click(screen.getByRole("button", { name: copy.cancel }));
    expect(details.open).toBe(false);
    expect(trigger).toHaveFocus();
    details.open = true;
    expect(screen.getByLabelText(copy.label)).toHaveValue("");
    expect(screen.getByRole("button", { name: copy.submit })).toBeDisabled();
  });
});
