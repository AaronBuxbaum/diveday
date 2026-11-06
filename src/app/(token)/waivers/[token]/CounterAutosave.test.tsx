// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("saves the draft when focus leaves a step, and says it did", async () => {
    const action = vi.fn(async (_formData: FormData) => "saved" as const);
    const { container } = renderForm(action);
    const [first, second] = container.querySelectorAll("input");
    if (!first || !second) throw new Error("inputs missing");
    await act(async () => {
      fireEvent.focusOut(first, { relatedTarget: second });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0]?.[0]).toBeInstanceOf(FormData);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("reloads the page once the code has closed", async () => {
    const { container } = renderForm(vi.fn(async () => "closed" as const));
    const [first, second] = container.querySelectorAll("input");
    if (!first || !second) throw new Error("inputs missing");
    await act(async () => {
      fireEvent.focusOut(first, { relatedTarget: second });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(refresh).toHaveBeenCalled();
  });
});
