import { expect, it } from "vitest";
import { adult } from "./adult";

it("pins the boundary at eighteen", () => {
  expect(adult(18)).toBe(true);
  expect(adult(17)).toBe(false);
});
