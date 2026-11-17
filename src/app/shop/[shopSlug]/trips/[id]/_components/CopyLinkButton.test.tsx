// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { rendersFlush } from "@/test/button-flush";
import { CopyLinkButton } from "./CopyLinkButton";

afterEach(cleanup);

const labels = { label: "Copy link", copiedLabel: "Copied", failedLabel: "Copy failed" };

/**
 * The trip's About panel opens its action row with this button, and its word
 * sat 12px inside "THE PLAN" and the rules under it (x 185 against 173; pixel
 * probe, DEPARTURE-1-07 / 2-06 / 4-12, K-06). The row asks for it; the
 * button's other caller, if one comes, need not.
 */
it("puts its word on the column when its row asks", () => {
  render(<CopyLinkButton path="/s/blue-mantis/trips/t1" flush {...labels} />);
  expect(rendersFlush(screen.getByRole("button", { name: "Copy link" }), "ghost", "sm")).toBe(true);
});

it("keeps its padding unless asked", () => {
  render(<CopyLinkButton path="/s/blue-mantis/trips/t1" {...labels} />);
  expect(rendersFlush(screen.getByRole("button", { name: "Copy link" }), "ghost", "sm")).toBe(
    false,
  );
});

/**
 * **A copy that cannot fail into "Select the link above"** (Trip page rebuild,
 * layer C): the button stands alone on its row, so there was no link above to
 * select. When the clipboard refuses, the link itself appears, selected.
 */
it("shows the link, selected, when the clipboard refuses", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error("denied")) },
  });
  render(<CopyLinkButton path="/s/blue-mantis/trips/t1" {...labels} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  const field = await screen.findByRole("textbox", { name: "Copy failed" });
  expect((field as HTMLInputElement).value).toBe("http://localhost:3000/s/blue-mantis/trips/t1");
  expect(document.activeElement).toBe(field);
});

it("says nothing more when the copy works", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });
  render(<CopyLinkButton path="/s/blue-mantis/trips/t1" {...labels} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect(await screen.findByText("Copied")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});
