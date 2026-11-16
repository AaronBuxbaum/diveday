// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MoreMenuTrace } from "./MoreMenuTrace";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

it("writes taps and the More button's state changes on screen", async () => {
  const button = document.createElement("button");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "More";
  document.body.append(button);
  render(<MoreMenuTrace />);
  await act(async () => {
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.setAttribute("aria-expanded", "true");
  });
  expect(screen.getByText(/pointerdown BUTTON More/)).toBeVisible();
  expect(screen.getByText(/aria-expanded=true BUTTON More/)).toBeVisible();
});
