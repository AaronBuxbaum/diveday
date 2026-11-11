// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConservationActions } from "./ConservationActions";
import { type ConservationCopy, ConservationForm } from "./ConservationForm";

const save = vi.hoisted(() => vi.fn());
const undo = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/undo", () => ({ undoAction: undo }));
vi.mock("../conservation-actions", () => ({ recordConservationAction: save }));
afterEach(cleanup);
beforeEach(() => {
  save.mockReset();
  undo.mockReset();
});
const copy: ConservationCopy = {
  kind: "Action",
  lionfishHint: "Follow local removal rules.",
  quantity: "Quantity",
  location: "Location",
  note: "Note",
  save: "Save",
  add: "Record",
  pending: "Saving",
  delete: "Delete",
  deleted: "Record deleted",
  undo: "Undo",
  dismiss: "Dismiss",
  saved: "Saved",
  kinds: {
    litter_kg: "Litter kg",
    litter_items: "Litter items",
    line_m: "Line m",
    lionfish_count: "Lionfish removed",
  },
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
    render(
      <ConservationActions shopSlug="blue-mantis" tripId="departure" copy={copy}>
        <ConservationForm tripId="departure" copy={copy} />
      </ConservationActions>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("spinbutton", { name: "Quantity" }), "1.5");
    await user.type(screen.getByRole("textbox", { name: "Note" }), "Keep my collection note");
    await user.click(screen.getByRole("button", { name: /^Record$/ }));
    expect(await screen.findByText(copy.errors[reason])).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "Quantity" })).toHaveValue(1.5);
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("Keep my collection note");
  },
);

it("deletes immediately and keeps an Undo action above the removed row", async () => {
  save.mockResolvedValue({ ok: true, targetId: "record", undo: { id: "record", revision: 2 } });
  const view = render(
    <ConservationActions shopSlug="blue-mantis" tripId="departure" copy={copy}>
      <ConservationForm
        tripId="departure"
        copy={copy}
        row={{
          id: "record",
          revision: 1,
          kind: "litter_kg",
          quantity: 1,
          location: "Reef",
          note: "Litter",
        }}
      />
    </ConservationActions>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("button", { name: "Undo" })).toBeVisible();
  view.rerender(
    <ConservationActions shopSlug="blue-mantis" tripId="departure" copy={copy}>
      <p>Empty</p>
    </ConservationActions>,
  );
  expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
  save.mockResolvedValue({ ok: true, targetId: "record" });
  await userEvent.setup().click(screen.getByRole("button", { name: "Undo" }));
  const form = undo.mock.calls.at(-1)?.[1] as FormData;
  expect(form.get("undo")).toBe("trip-conservation");
  expect(form.get("undoRevision")).toBe("2");
});

it("uses whole counts and local guidance only for lionfish, and preserves a draft on kind changes", async () => {
  render(
    <ConservationActions shopSlug="blue-mantis" tripId="departure" copy={copy}>
      <ConservationForm tripId="departure" copy={copy} />
    </ConservationActions>,
  );
  const user = userEvent.setup();
  const kind = screen.getByRole("combobox", { name: "Action" });
  const quantity = screen.getByRole("spinbutton", { name: "Quantity" });
  await user.type(quantity, "1.5");
  await user.selectOptions(kind, "lionfish_count");
  expect(screen.getByText(copy.lionfishHint)).toBeVisible();
  expect(quantity).toHaveAttribute("step", "1");
  expect(quantity).toHaveAttribute("min", "1");
  expect(quantity).toHaveValue(1.5);
  expect(quantity).toBeInvalid();
  await user.clear(quantity);
  await user.type(quantity, "3");
  expect(quantity).toBeValid();
  await user.selectOptions(kind, "line_m");
  expect(screen.queryByText(copy.lionfishHint)).not.toBeInTheDocument();
  expect(quantity).toHaveAttribute("step", "0.01");
  expect(quantity).toHaveValue(3);
});
