// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
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

  it("asks nothing about anybody's diving", () => {
    // The per-diver certification question lived here between 2026-08-20 and
    // 2026-08-27; `/ready/<token>` asks the diver whose booking it is instead
    // (ADR 20260820-attested-at-booking-verified-at-boarding, amended). The
    // party editor collects names, addresses and one phone number.
    renderDiver(<BookingPartyFields maxPartySize={3} />);
    fireEvent.change(screen.getByRole("combobox", { name: /number of divers/i }), {
      target: { value: "3" },
    });
    expect(document.querySelector('select[name^="certificationLevel"]')).toBeNull();
    expect(document.querySelector('[name^="certificationAgency"]')).toBeNull();
    expect(document.querySelector('[name^="certificationNumber"]')).toBeNull();
  });

  it("shows the big-group escape hatch once the party cap is below the maximum (task 24)", () => {
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
    // Against the constant, not a literal: the cap moved from 6 to 20 once
    // `createBookingParty`'s cost was measured (issue #725), and a test that
    // hard-codes it stops testing the thing it names the moment it moves again.
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    expect(screen.queryByText(/bringing more than/i)).not.toBeInTheDocument();
  });

  it("renders a name and email box for every seat the diver picked", async () => {
    // The regression this exists for: `diverSlots` was a six-name tuple, so
    // raising MAX_PUBLIC_PARTY_SIZE silently left the *form* capped at six
    // while the select offered twenty. A party of nine rendered six fieldsets
    // and submitted three blank names for boxes nobody was shown — and the
    // validator, which loops the submitted size, would point at fields that do
    // not exist. Asserted at the cap, since that is where a fixed-length list
    // would fail.
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    fireEvent.change(screen.getByRole("combobox", { name: /number of divers/i }), {
      target: { value: String(MAX_PUBLIC_PARTY_SIZE) },
    });
    expect(document.querySelectorAll('input[name^="fullName-"]')).toHaveLength(
      MAX_PUBLIC_PARTY_SIZE,
    );
    expect(
      document.querySelector(`input[name="fullName-${MAX_PUBLIC_PARTY_SIZE - 1}"]`),
    ).not.toBeNull();
  });

  it("offers every seat up to the measured cap when the boat has room", () => {
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(MAX_PUBLIC_PARTY_SIZE);
    // A dive club of nine and a family of eight are the cases the old cap of
    // six turned into two unrelated parties.
    expect(options.at(-1)).toHaveTextContent(String(MAX_PUBLIC_PARTY_SIZE));
  });
});
