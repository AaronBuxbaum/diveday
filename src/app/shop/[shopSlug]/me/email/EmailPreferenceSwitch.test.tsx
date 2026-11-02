// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EmailPreferenceSwitch } from "./EmailPreferenceSwitch";

afterEach(cleanup);
const words = { label: "Monday email", saving: "Saving…", failed: "Not saved. Try again." };

it("retains the confirmed value while pending and after a rejected save", async () => {
  let reject: (reason: Error) => void = () => {};
  const save = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  render(<EmailPreferenceSwitch wanted={false} {...words} save={save} />);
  const control = screen.getByRole("switch", { name: words.label });
  await userEvent.click(control);
  expect(control).not.toBeChecked();
  expect(control).toHaveAttribute("aria-disabled", "true");
  expect(control).toHaveFocus();
  await userEvent.click(control);
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(words.saving);
  await act(async () => reject(new Error("not saved")));
  expect(control).not.toBeChecked();
  expect(control).not.toHaveAttribute("aria-disabled");
  expect(control).toHaveFocus();
  expect(screen.getByRole("alert")).toHaveTextContent(words.failed);
});

it("settles only after save succeeds and supports the keyboard", async () => {
  const save = vi.fn(async () => {});
  render(<EmailPreferenceSwitch wanted={true} {...words} save={save} />);
  const control = screen.getByRole("switch", { name: words.label });
  control.focus();
  await userEvent.keyboard(" ");
  expect(save).toHaveBeenCalledWith(false);
  expect(control).not.toBeChecked();
  expect(control).toHaveFocus();
  expect(screen.queryByRole("alert")).toBeNull();
});
