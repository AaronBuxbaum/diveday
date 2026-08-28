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

    fireEvent.click(screen.getByRole("radio", { name: "2 divers" }));
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
    fireEvent.click(screen.getByRole("radio", { name: "2 divers" }));

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
    fireEvent.click(screen.getByRole("radio", { name: "3 divers" }));
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

/**
 * The party count is a **segmented row up to six, a `<select>` above it** (ADR
 * 20260827-the-divers-thread, decision 2). `MAX_PUBLIC_PARTY_SIZE` is 20 and a
 * twenty-segment track fits no phone, so the fallback is not a nicety — it is
 * the reason the rule has a number in it at all.
 *
 * Both shapes answer to one accessible name and carry one hydration flag,
 * which is what lets anything reading this form — a spec included — ask for
 * "Number of divers" without first working out how many seats are left.
 */
describe("BookingPartyFields — the party-count control", () => {
  it("renders a segmented row of radios, and no select, for a party of six or fewer", () => {
    renderDiver(<BookingPartyFields maxPartySize={6} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "1 diver" })).toBeChecked();
  });

  it("submits the chosen count under the name the booking action parses", () => {
    renderDiver(<BookingPartyFields maxPartySize={4} />);
    const three = screen.getByRole("radio", { name: "3 divers" });
    expect(three).toHaveAttribute("name", "partySize");
    fireEvent.click(three);
    expect(three).toBeChecked();
    expect(document.querySelectorAll('input[name^="fullName-"]')).toHaveLength(3);
  });

  it("falls back to the select once the boat has room for more than six", () => {
    renderDiver(<BookingPartyFields maxPartySize={7} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("combobox", { name: /number of divers/i })).toBeInTheDocument();
  });

  it("names itself and reports hydration in both shapes", () => {
    const { unmount } = renderDiver(<BookingPartyFields maxPartySize={5} />);
    expect(screen.getByLabelText("Number of divers")).toHaveAttribute("data-hydrated");
    unmount();
    renderDiver(<BookingPartyFields maxPartySize={MAX_PUBLIC_PARTY_SIZE} />);
    expect(screen.getByLabelText("Number of divers")).toHaveAttribute("data-hydrated");
  });
});
