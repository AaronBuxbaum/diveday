import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ signOut: vi.fn(async () => {}), redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: calls.redirect }));
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ api: { signOut: calls.signOut } }) }));

import { signOutAction } from "./command-palette-props";

it("signs out before redirecting with only a generic incomplete-cleanup flag", async () => {
  await signOutAction(true);
  expect(calls.signOut).toHaveBeenCalledTimes(1);
  expect(calls.redirect).toHaveBeenCalledWith("/?device_cleanup=incomplete");
  expect(calls.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    calls.redirect.mock.invocationCallOrder[0],
  );
});
