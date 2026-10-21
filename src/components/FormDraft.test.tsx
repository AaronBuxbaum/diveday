// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rendersFlush } from "@/test/button-flush";
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
  vi.resetAllMocks();
  vi.useRealTimers();
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

  it("spans the recovery note across the parent form's grid columns", () => {
    renderForm({ fields: { fullName: "Emmet O'Brien" }, savedAtLabel: "6:02 AM" });
    expect(screen.getByRole("status")).toHaveClass("col-span-full");
  });

  it("Start over empties the form, drops the line, and discards the draft", async () => {
    const user = userEvent.setup();
    renderForm({ fields: { fullName: "Emmet O'Brien" }, savedAtLabel: "6:02 AM" });
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.queryByRole("status")).toBeNull();
    expect(discardFormDraftAction).toHaveBeenCalledWith("new_diver");
  });

  /**
   * The line is one sentence and its act: "Start over" follows the words at
   * the row's own gap, not the gap and the link's padding. A `px-0` handed
   * through `className` lost to the size's `px-3` by stylesheet order
   * (pixel-craft K-223); `flush` is the spelling that works.
   */
  it("sets Start over after the line's words at the row's gap, with no padding of its own", () => {
    renderForm({ fields: { fullName: "Emmet O'Brien" }, savedAtLabel: "6:02 AM" });
    expect(rendersFlush(screen.getByRole("button", { name: "Start over" }), "link", "sm")).toBe(
      true,
    );
  });

  /**
   * Every server action on a staff page refreshes its route (the session
   * read re-sets the cookie cache, and Next treats any `cookies().set()` as a
   * mutation), and the refreshed page hands this component the draft it just
   * saved as a brand-new object. Re-applying it put the snapshot back over
   * whatever was typed or picked after the save went out: the board's add
   * panel saved departures without the boat the desk had chosen (issues
   * #2197, #2223).
   */
  it("applies the draft once: a refreshed page handing it back never writes over later edits", async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm({ fields: { fullName: "Emmet" }, savedAtLabel: "6:02 AM" });
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Emmet O'Brien");
    await user.selectOptions(screen.getByLabelText("Seats"), "2");
    rerender(
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
        <FormDraft
          form="new_diver"
          draft={{ fields: { fullName: "Emmet", seats: "1" }, savedAtLabel: "6:03 AM" }}
          actions={{ ...actions }}
          copy={copy}
        />
        <button type="submit">Add</button>
      </form>,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Emmet O'Brien");
    expect(screen.getByLabelText("Seats")).toHaveValue("2");
  });

  it("a refresh while a save is pending does not cancel the save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { rerender } = render(
        <form aria-label="New diver">
          <label>
            Name
            <input name="fullName" defaultValue="" />
          </label>
          <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        </form>,
      );
      const name = screen.getByLabelText("Name");
      await act(async () => {
        name.focus();
        (name as HTMLInputElement).value = "Ada";
        name.blur();
      });
      // The route refreshes before the debounce runs out, as it does after
      // any other action on the page answers.
      rerender(
        <form aria-label="New diver">
          <label>
            Name
            <input name="fullName" defaultValue="" />
          </label>
          <FormDraft form="new_diver" draft={null} actions={{ ...actions }} copy={copy} />
        </form>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(saveFormDraftAction).toHaveBeenCalledWith("new_diver", [["fullName", "Ada"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves the latest input on immediate unmount without waiting for blur", async () => {
    const { unmount } = renderForm(null);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.input(screen.getByLabelText("Card number"), { target: { value: "4242" } });
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenCalledWith("new_diver", [
      ["fullName", "Ada"],
      ["seats", "1"],
    ]);
  });

  it("flushes a pending blur save on unmount instead of cancelling it", async () => {
    const { unmount } = renderForm(null);
    const name = screen.getByLabelText("Name");
    name.focus();
    fireEvent.input(name, { target: { value: "Ada" } });
    name.blur();
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenCalledWith("new_diver", [
      ["fullName", "Ada"],
      ["seats", "1"],
    ]);
  });

  it("serializes snapshots so an older completion cannot replace newer input", async () => {
    vi.useFakeTimers();
    let finishFirst = () => {};
    saveFormDraftAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const { unmount } = renderForm(null);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    unmount();
    expect(saveFormDraftAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishFirst();
    });
    expect(saveFormDraftAction).toHaveBeenLastCalledWith("new_diver", [
      ["fullName", "Ada Lovelace"],
      ["seats", "1"],
    ]);
  });

  it("retries a rejected save on leaving and saves later edits", async () => {
    vi.useFakeTimers();
    saveFormDraftAction.mockRejectedValueOnce(new Error("Offline"));
    const { unmount } = renderForm(null);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    fireEvent.blur(screen.getByLabelText("Name"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(saveFormDraftAction).toHaveBeenCalledTimes(2);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenLastCalledWith("new_diver", [
      ["fullName", "Ada Lovelace"],
      ["seats", "1"],
    ]);
  });

  it("Start over waits for an older save and never saves it again on unmount", async () => {
    vi.useFakeTimers();
    let finishSave = () => {};
    saveFormDraftAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const { unmount } = renderForm({ fields: { fullName: "Emmet" }, savedAtLabel: "6:02 AM" });
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(discardFormDraftAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    await act(async () => {
      finishSave();
    });
    expect(discardFormDraftAction).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Name")).toHaveValue("");
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenCalledTimes(1);
  });

  it("a rejected discard keeps the fields and recovery line, then allows retry", async () => {
    discardFormDraftAction.mockRejectedValueOnce(new Error("Offline"));
    renderForm({ fields: { fullName: "Emmet" }, savedAtLabel: "6:02 AM" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Emmet");
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start over" })).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    });
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(discardFormDraftAction).toHaveBeenCalledTimes(2);
  });

  it("preserves edits made while Start over is waiting for its discard", async () => {
    let finishDiscard = () => {};
    discardFormDraftAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDiscard = resolve;
        }),
    );
    renderForm({ fields: { fullName: "Emmet" }, savedAtLabel: "6:02 AM" });
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    await act(async () => {});
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    await act(async () => {
      finishDiscard();
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    expect(saveFormDraftAction).toHaveBeenLastCalledWith("new_diver", [
      ["fullName", "Ada"],
      ["seats", "1"],
    ]);
  });

  it("effect replay neither saves an untouched form nor loses the first edit", async () => {
    const { unmount } = render(
      <StrictMode>
        <form>
          <input name="fullName" aria-label="Name" />
          <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        </form>
      </StrictMode>,
    );
    expect(saveFormDraftAction).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenCalledExactlyOnceWith("new_diver", [["fullName", "Ada"]]);
  });

  it("waits for saves before submitting once, preserving the clicked submitter", async () => {
    let finishSave = () => {};
    saveFormDraftAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const submitted = vi.fn();
    const { unmount } = render(
      <form
        onSubmit={(event) => {
          if (!event.defaultPrevented) submitted((event.nativeEvent as SubmitEvent).submitter);
          event.preventDefault();
        }}
      >
        <input name="fullName" aria-label="Name" />
        <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        <button type="submit" name="intent" value="add">
          Add
        </button>
      </form>,
    );
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    const button = screen.getByRole("button", { name: "Add" });
    fireEvent.click(button);
    await act(async () => {});
    expect(submitted).not.toHaveBeenCalled();
    fireEvent.click(button);
    await act(async () => {
      finishSave();
    });
    expect(submitted).toHaveBeenCalledExactlyOnceWith(button);
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenCalledTimes(1);
  });

  it("keeps edits made while submission is waiting in its recovery snapshot", async () => {
    let finishSave = () => {};
    saveFormDraftAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const submitted = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          if (!event.defaultPrevented) submitted();
          event.preventDefault();
        }}
      >
        <input name="fullName" aria-label="Name" />
        <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        <button type="submit">Add</button>
      </form>,
    );
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await act(async () => {});
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    await act(async () => {
      finishSave();
    });
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(saveFormDraftAction).toHaveBeenLastCalledWith("new_diver", [
      ["fullName", "Ada Lovelace"],
    ]);
  });

  it("a rejected save still allows the form action and later refused-form edits", async () => {
    saveFormDraftAction.mockRejectedValueOnce(new Error("Offline"));
    const formAction = vi.fn(async () => {});
    const { unmount } = render(
      <form action={formAction}>
        <input name="fullName" aria-label="Name" />
        <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        <button type="submit">Add</button>
      </form>,
    );
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    expect(formAction).toHaveBeenCalledTimes(1);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenLastCalledWith("new_diver", [
      ["fullName", "Ada Lovelace"],
    ]);
  });

  it("uses the clicked button's formAction after waiting for the save", async () => {
    const defaultAction = vi.fn(async () => {});
    const alternateAction = vi.fn(async () => {});
    render(
      <form action={defaultAction}>
        <input name="fullName" aria-label="Name" required />
        <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        <button type="submit" formAction={alternateAction}>
          Alternate
        </button>
      </form>,
    );
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Alternate" }));
    });
    expect(defaultAction).not.toHaveBeenCalled();
    expect(alternateAction).toHaveBeenCalledTimes(1);
  });

  it("native validation still blocks invalid input and does not disable later saves", async () => {
    const formAction = vi.fn(async () => {});
    const { unmount } = render(
      <form action={formAction}>
        <input name="fullName" aria-label="Name" required />
        <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        <button type="submit">Add</button>
      </form>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    expect(formAction).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenLastCalledWith("new_diver", [["fullName", "Ada"]]);
  });

  it("validation that becomes invalid while a save is pending leaves saving enabled", async () => {
    let finishSave = () => {};
    saveFormDraftAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const formAction = vi.fn(async () => {});
    const { unmount } = render(
      <form action={formAction}>
        <input name="fullName" aria-label="Name" required />
        <FormDraft form="new_diver" draft={null} actions={actions} copy={copy} />
        <button type="submit">Add</button>
      </form>,
    );
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await act(async () => {});
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "" } });
    await act(async () => {
      finishSave();
    });
    expect(formAction).not.toHaveBeenCalled();
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    unmount();
    await act(async () => {});
    expect(saveFormDraftAction).toHaveBeenLastCalledWith("new_diver", [
      ["fullName", "Ada Lovelace"],
    ]);
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
