// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmitButton } from "./SubmitButton";

afterEach(cleanup);

/**
 * `confirmMessage` is the shared destructive-action confirm every "are you
 * sure?" button in the app goes through (schedule remove, team delete,
 * calendar rotate/turn-off, and — as of the reviews moderation queue — hiding
 * a published review). Covering it once here covers all of them.
 */
describe("SubmitButton confirmMessage", () => {
  it("submits immediately when there is no confirm message", async () => {
    const action = vi.fn(async () => {});
    render(
      <form action={action}>
        <SubmitButton pendingLabel="Saving…">Hide</SubmitButton>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(action).toHaveBeenCalledOnce();
  });

  it("asks first, and skips the submit when the operator cancels", async () => {
    const action = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <form action={action}>
        <SubmitButton pendingLabel="Saving…" confirmMessage="Hide this review?">
          Hide
        </SubmitButton>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(confirmSpy).toHaveBeenCalledWith("Hide this review?");
    expect(action).not.toHaveBeenCalled();
  });

  it("submits once the operator confirms", async () => {
    const action = vi.fn(async () => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <form action={action}>
        <SubmitButton pendingLabel="Saving…" confirmMessage="Hide this review?">
          Hide
        </SubmitButton>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(action).toHaveBeenCalledOnce();
  });
});

/**
 * **A form with several answers** (a found item's Returned and Discarded, a gear return's fast
 * answers): while one posts, none can be pressed again, and only the one pressed says so.
 */
describe("SubmitButton with a name and a value", () => {
  it("disables every answer while one posts, and marks only the one pressed", async () => {
    let finish: () => void = () => {};
    const action = vi.fn(
      (_data: FormData) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <form action={action}>
        <SubmitButton name="intent" value="returned" pendingLabel="Returning…">
          Returned
        </SubmitButton>
        <SubmitButton name="intent" value="discarded" pendingLabel="Discarding…">
          Discarded
        </SubmitButton>
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Returned" }));
    const pressed = await screen.findByRole("button", { name: "Returning…" });
    const other = screen.getByRole("button", { name: "Discarded" });
    expect(pressed).toBeDisabled();
    expect(pressed).toHaveAttribute("aria-busy", "true");
    expect(other).toBeDisabled();
    expect(other).toHaveAttribute("aria-busy", "false");
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]?.[0].get("intent")).toBe("returned");

    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Returned" })).toBeEnabled());
  });
});
