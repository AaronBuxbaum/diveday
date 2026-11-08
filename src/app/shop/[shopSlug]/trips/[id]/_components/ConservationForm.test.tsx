// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type ConservationCopy, ConservationForm } from "./ConservationForm";

const save = vi.hoisted(() => vi.fn());
vi.mock("../conservation-actions", () => ({ recordConservationAction: save }));
afterEach(cleanup);
beforeEach(() => save.mockReset());
const copy: ConservationCopy = {
  kind: "Action",
  quantity: "Quantity",
  location: "Location",
  note: "Note",
  save: "Save",
  add: "Record",
  pending: "Saving",
  delete: "Delete",
  confirmDelete: "Delete record?",
  saved: "Saved",
  kinds: { litter_kg: "Litter kg", litter_items: "Litter items", line_m: "Line m" },
  errors: {
    invalid: "Enter a measured quantity",
    not_authorized: "No access",
    unavailable: "Unavailable",
    not_returned: "Not returned",
    stale: "Record changed",
  },
};

it.each(["invalid", "stale"] as const)(
  "keeps the draft when the server refuses it as %s",
  async (reason) => {
    save.mockResolvedValue({ ok: false, reason });
    render(<ConservationForm tripId="departure" copy={copy} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("spinbutton", { name: "Quantity" }), "1.5");
    await user.type(screen.getByRole("textbox", { name: "Note" }), "Keep my collection note");
    await user.click(screen.getByRole("button", { name: /^Record$/ }));
    expect(await screen.findByText(copy.errors[reason])).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "Quantity" })).toHaveValue(1.5);
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("Keep my collection note");
  },
);
