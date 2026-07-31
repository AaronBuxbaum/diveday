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
