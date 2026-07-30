// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { BookingPartyFields } from "./BookingPartyFields";

afterEach(() => {
  cleanup();
});

describe("BookingPartyFields Name Typo Suggestion", () => {
  const knownDivers = [
    { fullName: "Dana Reyes", email: "dana.reyes@example.com" },
    { fullName: "Sal Moretti", email: "sal@example.com" },
  ];

  it("suggests a corrected name typo on blur", () => {
    renderDiver(<BookingPartyFields maxPartySize={6} knownDivers={knownDivers} />);

    const nameInput = screen.getByRole("textbox", { name: /name/i });

    // Type a close typo name
    fireEvent.change(nameInput, { target: { value: "Dana Ryse" } });

    // Suggestion shouldn't be visible before blur
    expect(screen.queryByText(/did you mean/i)).toBeNull();

    // Blur the input to trigger suggestion check
    fireEvent.blur(nameInput);

    // Suggestion should now be visible
    expect(screen.getByText((content) => content.includes("Dana Reyes"))).toBeInTheDocument();
  });

  it("autofills both name and email fields when clicking the suggestion", () => {
    renderDiver(<BookingPartyFields maxPartySize={6} knownDivers={knownDivers} />);

    const nameInput = screen.getByRole("textbox", { name: /name/i });

    // Type a close typo name and blur
    fireEvent.change(nameInput, { target: { value: "Dana Ryse" } });
    fireEvent.blur(nameInput);

    const suggestionButton = screen.getByRole("button", { name: /did you mean/i });
    expect(suggestionButton).toBeInTheDocument();

    // Click the suggestion button
    fireEvent.click(suggestionButton);

    // Inputs should be updated
    expect(nameInput).toHaveValue("Dana Reyes");

    // Check that email field also updated
    const emailInput = screen.getByRole("textbox", { name: /email/i });
    expect(emailInput).toHaveValue("dana.reyes@example.com");

    // Suggestion goes away after click
    expect(screen.queryByRole("button", { name: /did you mean/i })).toBeNull();
  });

  it("only offers name autofill for the lead diver", () => {
    renderDiver(<BookingPartyFields maxPartySize={2} />);

    fireEvent.change(screen.getByRole("combobox", { name: /number of divers/i }), {
      target: { value: "2" },
    });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("autocomplete", "name");
    expect(screen.getByRole("textbox", { name: "Diver 2 name" })).toHaveAttribute(
      "autocomplete",
      "off",
    );
  });
});
