// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
