// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoShowSalvage, type NoShowSalvageCopy, NoShowScript } from "./NoShowScript";

afterEach(() => {
  cleanup();
});

const scriptCopy = {
  door: "Not here?",
  consequence:
    "Records that they did not arrive and frees the seat. You can put them back while the seat is still free.",
  confirm: "Mark not here",
  confirming: "Marking…",
  confirmAriaLabel: "Mark Nadia Petrov as not here",
};

const money = {
  line: "Marking someone not here does not charge or refund anything.",
  href: "/shop/blue-mantis/orders?personId=person-1",
  label: "Open their orders",
};

function salvage(overrides: Partial<NoShowSalvageCopy> = {}): NoShowSalvageCopy {
  return { line: "Nobody is waiting for this seat.", links: [], money, ...overrides };
}

describe("NoShowScript", () => {
  /**
   * Closed, the door is three words and nothing else. The counter's promise is
   * a name and one large tap, and a second peer control beside that tap is the
   * mis-tap this surface spent a slice removing — so the consequence sentence
   * and the confirm live inside the disclosure, not beside the check-in row.
   */
  it("keeps the confirm inside the disclosure rather than beside the row's tap", () => {
    const { container } = render(
      <NoShowScript action={vi.fn()} bookingId="booking-1" copy={scriptCopy} />,
    );
    expect(screen.getByText("Not here?")).toBeTruthy();
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(
      details?.contains(screen.getByRole("button", { name: scriptCopy.confirmAriaLabel })),
    ).toBe(true);
  });

  /**
   * One row's confirm must not read like every other row's: three families can
   * be at the counter at once, and "Mark not here" repeated nine times is nine
   * identical accessible names over nine different people.
   */
  it("names the diver on the confirm", () => {
    render(<NoShowScript action={vi.fn()} bookingId="booking-1" copy={scriptCopy} />);
    expect(screen.getByRole("button", { name: "Mark Nadia Petrov as not here" })).toBeTruthy();
  });

  it("carries the booking the tap is about", () => {
    const { container } = render(
      <NoShowScript action={vi.fn()} bookingId="booking-1" copy={scriptCopy} />,
    );
    expect(container.querySelector('input[name="bookingId"]')?.getAttribute("value")).toBe(
      "booking-1",
    );
  });
});

describe("NoShowSalvage", () => {
  it("offers the wait list when somebody is waiting", () => {
    render(
      <NoShowSalvage
        copy={salvage({
          line: "2 divers are waiting for this seat",
          links: [{ href: "/shop/blue-mantis/trips/trip-1/guests", label: "Open the wait list" }],
        })}
      />,
    );
    expect(screen.getByText("2 divers are waiting for this seat")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the wait list" }).getAttribute("href")).toBe(
      "/shop/blue-mantis/trips/trip-1/guests",
    );
  });

  it("offers the diver another day when nobody is waiting", () => {
    render(
      <NoShowSalvage
        copy={salvage({
          line: "Nobody is waiting. Offer Nadia Petrov another day.",
          links: [
            {
              href: "/shop/blue-mantis/bookings/new/trip-2?diverq=Nadia%20Petrov",
              label: "Add them to Two-Tank Reef, Thu 8:00 AM",
            },
            {
              href: "/shop/blue-mantis/bookings/new/trip-3?diverq=Nadia%20Petrov",
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
    ).toBe("/shop/blue-mantis/bookings/new/trip-2?diverq=Nadia%20Petrov");
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
});
