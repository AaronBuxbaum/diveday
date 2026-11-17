// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CounterAutosave } from "./CounterAutosave";

const refresh = vi.fn();
vi.mock("./reload-page", () => ({ reloadPage: () => refresh() }));

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const copy = {
  closesAt: "This code works until {time}.",
  minutesOne: "1 minute left on this code, until {time}.",
  minutesOther: "{count} minutes left on this code, until {time}.",
  saved: "Saved.",
};

function renderForm(action: (formData: FormData) => Promise<"saved" | "closed">, minutes = 12) {
  return render(
    <form>
      <section>
        <input name="first" />
      </section>
      <section>
        <input name="second" />
        <CounterAutosave
          action={action}
          msLeft={minutes * 60_000}
          closesAt="10:42 AM"
          copy={copy}
        />
      </section>
    </form>,
  );
}

/** Issue #3985: a counter code says how long it has, and saves each step as the diver leaves it. */
describe("CounterAutosave", () => {
  it("says how many minutes the code has left", () => {
    renderForm(vi.fn(async () => "saved" as const));
    expect(screen.getByTestId("counter-time-left")).toHaveTextContent(
      "12 minutes left on this code, until 10:42 AM.",
    );
  });

  it("says nothing about time while the code has hours left (issue 4064)", () => {
    renderForm(
      vi.fn(async () => "saved" as const),
      6 * 60,
    );
    expect(screen.getByTestId("counter-time-left").textContent).toBe("");
  });

  it("saves the draft when focus leaves a step, and says it did", async () => {
    const action = vi.fn(async (_formData: FormData) => "saved" as const);
    const { container } = renderForm(action);
    const [first, second] = container.querySelectorAll("input");
    if (!first || !second) throw new Error("inputs missing");
    fireEvent.focusOut(first, { relatedTarget: second });
    // The status line is always in the page, so wait on its words, not on it.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0]?.[0]).toBeInstanceOf(FormData);
  });

  it("reloads the page once the code has closed", async () => {
    const { container } = renderForm(vi.fn(async () => "closed" as const));
    const [first, second] = container.querySelectorAll("input");
    if (!first || !second) throw new Error("inputs missing");
    fireEvent.focusOut(first, { relatedTarget: second });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  // Issue #4541: a step's save answered "closed" because the Sign it raced had
  // already signed the release, and the reload threw the signer off the
  // signed page (and the desk's next navigation with it).
  it("does not save a step the signer has already submitted", async () => {
    vi.useFakeTimers();
    try {
      const action = vi.fn(async () => "closed" as const);
      const { container } = renderForm(action);
      const second = container.querySelectorAll("input")[1];
      const form = container.querySelector("form");
      if (!second || !form) throw new Error("form missing");
      fireEvent.change(second, { target: { value: "typed" } });
      fireEvent.submit(form);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(action).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reload for a save that answers after the signer submitted", async () => {
    let answer: (outcome: "closed") => void = () => undefined;
    const action = vi.fn(() => new Promise<"closed">((resolve) => (answer = resolve)));
    const { container } = renderForm(action);
    const [first, second] = container.querySelectorAll("input");
    const form = container.querySelector("form");
    if (!first || !second || !form) throw new Error("form missing");
    fireEvent.focusOut(first, { relatedTarget: second });
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);
    answer("closed");
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not reload for a save that answers after the form is gone", async () => {
    let answer: (outcome: "closed") => void = () => undefined;
    const action = vi.fn(() => new Promise<"closed">((resolve) => (answer = resolve)));
    const { container, unmount } = renderForm(action);
    const [first, second] = container.querySelectorAll("input");
    if (!first || !second) throw new Error("inputs missing");
    fireEvent.focusOut(first, { relatedTarget: second });
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    unmount();
    answer("closed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).not.toHaveBeenCalled();
  });
});
