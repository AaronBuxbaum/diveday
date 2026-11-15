// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuestFolios } from "./GuestFolios";

const copy = {
  heading: "Who's coming",
  search: "Find a guest",
  all: "All guests",
  next: "Next guest needing attention",
  empty: "No guests match",
  party: "Travelling together",
  attention: "Needs attention",
  requirementsMet: "Boarding requirements met",
};
const guests = [
  {
    id: "maya",
    name: "Maya Chen",
    status: "Certification · waiver · shared payment",
    needsAttention: true,
    party: "Leo Chen",
    panel: (
      <li>
        <p>Verify certification</p>
        <p>Send waiver</p>
        <p>Shared payment</p>
      </li>
    ),
  },
  {
    id: "leo",
    name: "Leo Chen",
    status: "Waiver outstanding",
    needsAttention: true,
    party: "Maya Chen",
    panel: <li>Leo's waiver</li>,
  },
  {
    id: "ben",
    name: "Ben Carter",
    status: "Requirements met",
    needsAttention: false,
    party: null,
    panel: <li>Ben's details</li>,
  },
];
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
describe("Guest folios", () => {
  it("keeps independent remedies visible and Next changes only the selected guest", () => {
    render(<GuestFolios guests={guests} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: /Maya Chen/ }));
    expect(screen.getByText("Verify certification")).toBeVisible();
    expect(screen.getByText("Send waiver")).toBeVisible();
    expect(screen.getByText("Shared payment")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: copy.next }));
    expect(screen.getByRole("heading", { name: "Leo Chen" })).toBeVisible();
    expect(screen.getByText("Leo's waiver")).toBeVisible();
    expect(window.location.hash).toBe("#booking-leo");
    fireEvent.click(screen.getByRole("button", { name: copy.next }));
    expect(screen.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
  });
  it("opens a booking deep link and returns to a searchable guest index", () => {
    window.history.replaceState(null, "", "/#move-booking-leo");
    render(<GuestFolios guests={guests} copy={copy} />);
    expect(screen.getByRole("heading", { name: "Leo Chen" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: copy.all }));
    fireEvent.change(screen.getByRole("searchbox", { name: copy.search }), {
      target: { value: "Ben" },
    });
    expect(screen.getByRole("button", { name: /Ben Carter/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Maya Chen/ })).toBeNull();
  });
  it("keeps a refused booking selected after server refresh", () => {
    const view = render(<GuestFolios guests={guests} copy={copy} />);
    view.rerender(<GuestFolios guests={guests} copy={copy} initialBookingId="maya" />);
    expect(screen.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
  });
  it("commits the recruitment URL before revealing the overview unmounts its source link", () => {
    const withLink = [
      {
        ...guests[0],
        panel: (
          <li>
            <a href="#who-wants-in">Find waiting guests</a>
          </li>
        ),
      },
      ...guests.slice(1),
    ];
    render(
      <GuestFolios
        guests={withLink}
        copy={copy}
        initialBookingId="maya"
        overview={<p>Waiting guests</p>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    const navigation = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole("link", { name: "Find waiting guests" }), navigation);
    expect(screen.getByRole("heading", { name: copy.heading })).toBeVisible();
    expect(screen.getByText("Waiting guests")).toBeVisible();
    expect(window.location.hash).toBe("#who-wants-in");
  });
  it("keeps the recruitment destination on remount with an earlier booking context", () => {
    window.history.replaceState(null, "", "/#who-wants-in");
    render(
      <GuestFolios
        guests={guests}
        copy={copy}
        initialBookingId="maya"
        overview={<p>Offer recorded for waiting guest</p>}
      />,
    );
    expect(screen.getByRole("heading", { name: copy.heading })).toBeVisible();
    expect(screen.getByText("Offer recorded for waiting guest")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Maya Chen" })).toBeNull();
  });
});
