// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupRequestForm, type SetupRequestFormWords } from "./SetupRequestForm";

vi.mock("../actions", () => ({ submitSetupRequestAction: vi.fn() }));

afterEach(cleanup);

const words: SetupRequestFormWords = {
  shopName: "Shop name",
  region: "Town or region",
  runsBoat: "Do you run a boat?",
  yes: "Yes",
  no: "No",
  currentSystem: "Current tool (optional)",
  notSpecified: "Not specified",
  current: {
    paper: "Paper",
    spreadsheet: "Spreadsheets",
    booking_system: "A booking system",
    shop_software: "Dive-shop software",
    other: "Something else",
  },
  whichSystem: "Which one?",
  anotherSystem: "Another one",
  contactName: "Your name",
  email: "Email",
  phone: "Phone",
  website: "Website",
  submit: "Send",
  sending: "Sending…",
  errors: { required: "Fill this in.", invalid: "Check this one.", email: "Check the address." },
  rateLimited: "Too many tries.",
};

const systems = [
  { slug: "fareharbor", name: "FareHarbor" },
  { slug: "eve", name: "EVE" },
];

/**
 * "Which one?" (2026-10-22): asked after a booking system or dive-shop
 * software and nothing else, and already answered for a reader who came from
 * a switching guide's door.
 */
describe("SetupRequestForm, which system", () => {
  it("asks for contact details before optional migration routing", () => {
    const { container } = render(
      <SetupRequestForm source="pricing" words={words} systems={systems} />,
    );
    const email = screen.getByRole("textbox", { name: "Email" });
    const tool = screen.getByRole("combobox", { name: "Current tool (optional)" });
    expect(email.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('[name="currentSystem"][required]')).toHaveLength(0);
  });

  it("asks which one only after a booking system or dive-shop software", () => {
    render(<SetupRequestForm source="pricing" words={words} systems={systems} />);
    expect(screen.queryByText("Which one?")).toBeNull();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "paper" } });
    expect(screen.queryByText("Which one?")).toBeNull();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "booking_system" } });
    expect(screen.getByText("Which one?")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "FareHarbor" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Another one" })).toHaveAttribute("value", "");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "spreadsheet" } });
    expect(screen.queryByRole("radio", { name: "FareHarbor" })).toBeNull();
  });

  it("starts answered for a reader who came from a guide's door", () => {
    render(
      <SetupRequestForm
        source="switching-fareharbor-concierge"
        words={words}
        systems={systems}
        preselect={{ currentSystem: "booking_system", currentSystemGuide: "fareharbor" }}
      />,
    );
    expect(screen.getByRole("combobox")).toHaveValue("booking_system");
    expect(screen.getByRole("radio", { name: "FareHarbor" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "FareHarbor" })).toHaveAttribute(
      "name",
      "currentSystemGuide",
    );
  });
});
