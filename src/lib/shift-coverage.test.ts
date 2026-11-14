import { expect, it } from "vitest";
import { shiftsCoverWindow } from "./shift-coverage";

const window = (start: number, end: number) => ({
  startsAt: new Date(start),
  endsAt: new Date(end),
});
it("requires the whole departure, allowing adjacent shifts but never a gap", () => {
  expect(shiftsCoverWindow([window(0, 10)], window(0, 10))).toBe(true);
  expect(shiftsCoverWindow([window(5, 10), window(0, 5)], window(0, 10))).toBe(true);
  expect(shiftsCoverWindow([window(0, 4), window(5, 10)], window(0, 10))).toBe(false);
  expect(shiftsCoverWindow([window(1, 10)], window(0, 10))).toBe(false);
  expect(shiftsCoverWindow([window(0, 9)], window(0, 10))).toBe(false);
  expect(shiftsCoverWindow([], window(0, 10))).toBe(false);
});
