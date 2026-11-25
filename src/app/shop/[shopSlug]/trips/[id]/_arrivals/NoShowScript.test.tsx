// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoShowConfirm, NoShowSalvage, type NoShowSalvageCopy } from "./NoShowScript";

// The script's confirm posts through `RowActionForm`, which refreshes the row
// in place on a successful send — so this render needs a stand-in for the
// router context it has none of.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const scriptCopy = {
  door: "Not here",
  consequence:
    "Records that they did not arrive and frees the seat. You can put them back while the seat is still free.",
  confirm: "Mark not here",
  confirming: "Marking…",
  confirmAriaLabel: "Mark Nadia Petrov as not here",
  sendFailed: "That didn’t send. Tap it again.",
};

const money = {
  line: "Marking someone not here does not charge or refund anything.",
  href: "/shop/blue-mantis/orders?personId=person-1",
  label: "Open their orders",
};

function salvage(overrides: Partial<NoShowSalvageCopy> = {}): NoShowSalvageCopy {
  return { line: "Nobody is waiting for this seat.", links: [], money, ...overrides };
}

describe("NoShowConfirm", () => {
  /**
   * One row's confirm must not read like every other row's: three families can
   * be at the counter at once, and "Mark not here" repeated nine times is nine
   * identical accessible names over nine different people.
   */
  it("names the diver on the confirm", () => {
    render(<NoShowConfirm action={vi.fn()} bookingId="booking-1" copy={scriptCopy} />);
    expect(screen.getByRole("button", { name: "Mark Nadia Petrov as not here" })).toBeTruthy();
  });

  it("carries the booking the tap is about", () => {
    const { container } = render(
      <NoShowConfirm action={vi.fn()} bookingId="booking-1" copy={scriptCopy} />,
    );
    expect(container.querySelector('input[name="bookingId"]')?.getAttribute("value")).toBe(
      "booking-1",
    );
  });

  /** Every sheet of the opened guest ends on its confirm and "Never mind" (Move, Cancel). */
  it("draws its dismiss beside the confirm", () => {
    render(
      <NoShowConfirm
        action={vi.fn()}
        bookingId="booking-1"
        copy={scriptCopy}
        dismiss={<button type="button">Never mind</button>}
      />,
    );
    const confirm = screen.getByRole("button", { name: scriptCopy.confirmAriaLabel });
    expect(confirm.parentElement).toContainElement(
      screen.getByRole("button", { name: "Never mind" }),
    );
  });
});

describe("NoShowSalvage", () => {
  it("offers the wait list when somebody is waiting", () => {
    render(
      <NoShowSalvage
        copy={salvage({
          line: "2 divers are waiting for this seat",
          links: [
            {
              href: "/shop/blue-mantis/trips/trip-1?phase=filling#who-wants-in",
              label: "See who wants in",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("2 divers are waiting for this seat")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See who wants in" }).getAttribute("href")).toBe(
      "/shop/blue-mantis/trips/trip-1?phase=filling#who-wants-in",
    );
  });

  it("offers the diver another day when nobody is waiting", () => {
    render(
      <NoShowSalvage
        copy={salvage({
          line: "Nobody is waiting. Offer Nadia Petrov another day.",
          links: [
            {
              href: "/shop/blue-mantis/trips/trip-2?add=1&person=diver-1",
              label: "Add them to Two-Tank Reef, Thu 8:00 AM",
            },
            {
              href: "/shop/blue-mantis/trips/trip-3?add=1&person=diver-1",
              label: "Add them to Two-Tank Reef, Sat 8:00 AM",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Nobody is waiting. Offer Nadia Petrov another day.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Add them to Two-Tank Reef, Thu 8:00 AM" })
        .getAttribute("href"),
    ).toBe("/shop/blue-mantis/trips/trip-2?add=1&person=diver-1");
    expect(
      screen.getByRole("link", { name: "Add them to Two-Tank Reef, Sat 8:00 AM" }),
    ).toBeTruthy();
  });

  it("says so plainly when there is nothing to offer", () => {
    render(
      <NoShowSalvage
        copy={salvage({ line: "Nobody is waiting, and no similar departure has room for them." })}
      />,
    );
    expect(
      screen.getByText("Nobody is waiting, and no similar departure has room for them."),
    ).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(1);
  });

  /**
   * **The money is a sentence, never a control.** What happens to the fare —
   * a refund, a credit, a regular the owner waves through — is a decision a
   * person makes on the shop's own terms, and `markBookingNoShow` writes no
   * order, payment, refund or checkout row at all. This asserts the surface
   * keeps that promise rather than trusting the docblock that makes it.
   */
  it("states the money and links to it, and offers no charge or refund control", () => {
    const { container } = render(<NoShowSalvage copy={salvage()} />);
    expect(
      screen.getByText("Marking someone not here does not charge or refund anything."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open their orders" }).getAttribute("href")).toBe(
      "/shop/blue-mantis/orders?personId=person-1",
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  /**
   * **The rebooking offer goes to the diver in one tap** (UX review
   * 2026-10-11, item 14): beside each day's seating link, one button that
   * posts the departure and the diver, and nothing that charges or refunds.
   */
  it("puts one send button beside each offered day, posting the day and the diver", () => {
    const { container } = render(
      <NoShowSalvage
        offerAction={vi.fn()}
        copy={salvage({
          line: "Nobody is waiting. Offer Nadia Petrov another day.",
          links: [
            {
              href: "/shop/blue-mantis/trips/trip-2?add=1&person=diver-1",
              label: "Add them to Two-Tank Reef, Sat 8:00 AM",
              offer: {
                tripId: "trip-2",
                ariaLabel: "Email Nadia Petrov an offer for Two-Tank Reef, Sat 8:00 AM",
              },
            },
          ],
          offerCopy: {
            personId: "person-1",
            label: "Email them this date",
            pending: "Sending…",
            sendFailed: "That didn’t send. Tap it again.",
          },
        })}
      />,
    );
    const send = screen.getByRole("button", {
      name: "Email Nadia Petrov an offer for Two-Tank Reef, Sat 8:00 AM",
    });
    const form = send.closest("form");
    expect(form?.querySelector<HTMLInputElement>('input[name="offerTripId"]')?.value).toBe(
      "trip-2",
    );
    expect(form?.querySelector<HTMLInputElement>('input[name="personId"]')?.value).toBe("person-1");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("draws no send button without an action to post to", () => {
    const { container } = render(
      <NoShowSalvage
        copy={salvage({
          links: [
            { href: "/x", label: "Add them", offer: { tripId: "trip-2", ariaLabel: "Email" } },
          ],
          offerCopy: { personId: "person-1", label: "Email", pending: "…", sendFailed: "!" },
        })}
      />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
