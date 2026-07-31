// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDiver } from "@/test/intl";
import { BookingPartyFields } from "./BookingPartyFields";

afterEach(() => {
  cleanup();
});

describe("BookingPartyFields", () => {
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
