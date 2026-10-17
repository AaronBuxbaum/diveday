// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DecompressionReminder } from "./DecompressionReminder";

afterEach(cleanup);

it("is never hidden from print, so the printed packet keeps the line", () => {
  render(<DecompressionReminder text="Check the cards." />);
  const line = screen.getByText("Check the cards.").closest("p");
  expect(line?.className).not.toMatch(/print:hidden|(^|\s)hidden(\s|$)/);
});
