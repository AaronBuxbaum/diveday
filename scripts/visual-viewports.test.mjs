import { expect, test } from "vitest";
import { schemeViewports } from "../e2e/visual-viewports";

test("default captures keep the economical dark desktop and responsive light matrix", () => {
  expect(schemeViewports("dark")).toEqual([{ width: 1280, height: 800 }]);
  expect(schemeViewports("light")).toEqual([
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]);
});

test("explicit dark phone acceptance adds one phone without duplicating light or desktop", () => {
  const dark = schemeViewports("dark", true);
  expect(dark).toEqual(schemeViewports("light"));
  expect(dark.map(({ width }) => width)).toEqual([390, 1280]);
  expect(schemeViewports("light", true)).toEqual(schemeViewports("light"));
  expect(schemeViewports("dark")).toEqual([{ width: 1280, height: 800 }]);
});
