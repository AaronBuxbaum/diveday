import { expect, it } from "vitest";
import { adult } from "./adult";

it("tells a grown-up from a child, far from the boundary", () => {
  expect(adult(30)).toBe(true);
  expect(adult(5)).toBe(false);
});
