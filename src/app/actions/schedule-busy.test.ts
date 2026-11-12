import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
const { redirectOnScheduleBusy } = await import("./schedule-busy");
it("redirects a lock timeout to its caller's retry notice", () => {
  const error = Object.assign(new Error("lock"), { code: "55P03" });
  expect(() => redirectOnScheduleBusy(error, "/retry")).toThrow("REDIRECT:/retry");
});
it("propagates any other error", () => {
  const error = new Error("unexpected");
  expect(() => redirectOnScheduleBusy(error, "/retry")).toThrow(error);
});
