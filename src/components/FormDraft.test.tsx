// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormDraft } from "./FormDraft";

const saveFormDraftAction = vi.fn(async (_form: string, _fields: Array<[string, string]>) => {});
const discardFormDraftAction = vi.fn(async (_form: string) => {});
const actions = { save: saveFormDraftAction, discard: discardFormDraftAction };

const copy = { pickedUp: "Picked up from the desk, {time}.", startOver: "Start over" };

function renderForm(draft: { fields: Record<string, string>; savedAtLabel: string } | null) {
  return render(
    <form aria-label="New diver">
      <label>
        Name
        <input name="fullName" defaultValue="" />
      </label>
      <label>
        Card number
        <input name="cardNumber" defaultValue="" />
      </label>
      <label>
        Seats
        <select name="seats" defaultValue="1">
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </label>
      <FormDraft form="new_diver" draft={draft} actions={actions} copy={copy} />
      <button type="submit">Add</button>
    </form>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * ADR 20260906-before-you-ask, decision 3: nothing you typed is lost, and the
 * line that says so is the only thing the component adds to a surface.
 */
describe("FormDraft", () => {
  it("renders nothing at all when there is no draft", () => {
    renderForm(null);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("applies the draft to the form's own fields and says where it came from", () => {
    renderForm({
      fields: { fullName: "Emmet O'Brien", seats: "2", cardNumber: "4242" },
      savedAtLabel: "6:02 AM",
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Emmet O'Brien");
    expect(screen.getByLabelText("Seats")).toHaveValue("2");
    // The never-list holds on the way back in too.
    expect((screen.getByLabelText("Card number") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("Picked up from the desk, 6:02 AM.");
  });

  it("Start over empties the form, drops the line, and discards the draft", async () => {
    const user = userEvent.setup();
    renderForm({ fields: { fullName: "Emmet O'Brien" }, savedAtLabel: "6:02 AM" });
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.queryByRole("status")).toBeNull();
    expect(discardFormDraftAction).toHaveBeenCalledWith("new_diver");
  });

  it("keeps a draft of what is typed on blur, without the never-list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderForm(null);
      const name = screen.getByLabelText("Name");
      const card = screen.getByLabelText("Card number");
      await act(async () => {
        name.focus();
        (name as HTMLInputElement).value = "Ada";
        (card as HTMLInputElement).value = "4242";
        name.blur();
        card.focus();
        card.blur();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(saveFormDraftAction).toHaveBeenCalledWith("new_diver", [
        ["fullName", "Ada"],
        ["seats", "1"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
