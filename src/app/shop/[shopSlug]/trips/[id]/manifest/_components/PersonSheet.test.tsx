// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonSheet } from "./PersonSheet";

afterEach(cleanup);

const props = {
  name: "Meera Iyer",
  trigger: <span>Meera Iyer</span>,
  triggerLabel: "Open details for Meera Iyer",
  subtitle: "Diver · Own kit",
  status: <span>Not back aboard</span>,
  trail: [
    { label: "Boarded at the dock", detail: "6:51 · Dana", state: "aboard" as const },
    { label: "Not back after dive 1", detail: "8:29 · Keiko", state: "notBack" as const },
  ],
  todayLabel: "Today",
  noTodayEventsLabel: "No roll-call events recorded yet.",
  buddyLabel: "Buddy team",
  buddy: <span>Chinwe Obi · Aboard</span>,
  closeLabel: "Close person details",
  triggerClassName: "person-trigger",
  children: <p>Emergency contact Asha Iyer · +1-305-555-0231</p>,
};

describe("PersonSheet", () => {
  it("keeps the sheet out of the DOM until the person is opened", () => {
    render(<PersonSheet {...props} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a labelled bottom sheet without joining the roll-call mark", () => {
    render(
      <div>
        <PersonSheet {...props} />
        <button type="button">Mark boarded</button>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Today");
    expect(dialog).toHaveTextContent("Not back after dive 1");
    expect(dialog).toHaveTextContent("Asha Iyer · +1-305-555-0231");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Mark boarded" })).toBeInTheDocument();
  });

  it("closes from the explicit control, Escape, and the scrim", () => {
    render(<PersonSheet {...props} />);
    const trigger = screen.getByRole("button", { name: "Open details for Meera Iyer" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close person details" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("presentation"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
