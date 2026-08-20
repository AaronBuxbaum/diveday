// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { BookingPartyFields } from "./BookingPartyFields";

afterEach(() => {
  cleanup();
});

describe("BookingPartyFields", () => {
  it("scopes name/email autofill per diver rather than turning it off (task 22)", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);

    fireEvent.change(screen.getByRole("combobox", { name: /number of divers/i }), {
      target: { value: "2" },
    });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("autocomplete", "name");
    expect(screen.getByRole("textbox", { name: "Diver 2 name" })).toHaveAttribute(
      "autocomplete",
      "section-diver1 name",
    );
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("autocomplete", "email");
    expect(screen.getByRole("textbox", { name: "Diver 2 email" })).toHaveAttribute(
      "autocomplete",
      "section-diver1 email",
    );
  });

  it("makes a non-lead diver's email optional via the 'use main contact' checkbox (task 21)", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);
    fireEvent.change(screen.getByRole("combobox", { name: /number of divers/i }), {
      target: { value: "2" },
    });

    const email2 = screen.getByRole("textbox", { name: "Diver 2 email" });
    expect(email2).toBeRequired();

    fireEvent.click(screen.getByRole("checkbox", { name: /use the main contact's email/i }));
    expect(email2).toBeDisabled();
    expect(email2).not.toBeRequired();

    fireEvent.click(screen.getByRole("checkbox", { name: /use the main contact's email/i }));
    expect(email2).not.toBeDisabled();
    expect(email2).toBeRequired();
  });

  it("asks every diver what they hold, not just the booker", () => {
    // A party booking sells up to six seats and used to ask this once, so the
    // gate screened one seat in four (ADR
    // 20260820-attested-at-booking-verified-at-boarding's amendment).
    renderDiver(<BookingPartyFields maxPartySize={3} askCertification />);
    fireEvent.change(screen.getByRole("combobox", { name: /number of divers/i }), {
      target: { value: "3" },
    });
    const selects = document.querySelectorAll<HTMLSelectElement>(
      'select[name^="certificationLevel-"]',
    );
    expect(Array.from(selects, (select) => select.name)).toEqual([
      "certificationLevel-0",
      "certificationLevel-1",
      "certificationLevel-2",
    ]);
  });

  it("leaves the question off the wait lists, which gate on nothing", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);
    expect(document.querySelector('select[name^="certificationLevel"]')).toBeNull();
  });

  it("warns the diver whose own answer is short, and never blocks the form", () => {
    renderDiver(
      <BookingPartyFields
        maxPartySize={2}
        askCertification
        belowRequirementFor={(level) =>
          level === "open_water" ? "This trip is set for Rescue." : null
        }
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: /number of divers/i }), {
      target: { value: "2" },
    });
    const [first] = document.querySelectorAll<HTMLSelectElement>(
      'select[name^="certificationLevel-"]',
    );
    if (!first) throw new Error("expected a certification select");

    expect(screen.queryByText("This trip is set for Rescue.")).not.toBeInTheDocument();
    fireEvent.change(first, { target: { value: "open_water" } });

    // Said once, under the diver who said it — not once for the whole party.
    expect(screen.getAllByText("This trip is set for Rescue.")).toHaveLength(1);
    // And it is a warning: the select is still free, and nothing is disabled.
    expect(first).not.toBeDisabled();
    expect(first).not.toBeRequired();
  });

  it("shows the big-group escape hatch once the party cap is below 6 (task 24)", () => {
    renderDiver(
      <BookingPartyFields maxPartySize={3} contactEmail="dive@example.com" contactPhone={null} />,
    );
    expect(screen.getByText(/bringing more than 3/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /contact the shop/i })).toHaveAttribute(
      "href",
      "mailto:dive@example.com",
    );
  });

  it("hides the big-group escape hatch when the full party size is still selectable", () => {
    renderDiver(<BookingPartyFields maxPartySize={6} />);
    expect(screen.queryByText(/bringing more than/i)).not.toBeInTheDocument();
  });
});
