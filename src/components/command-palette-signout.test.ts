import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  redirect: vi.fn((_path: string): never => {
    throw new Error("redirect");
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({ api: { signOut: mocks.signOut } })),
}));

import { signOutAction } from "./command-palette-props";

it("signs out before redirecting an incomplete device cleanup to the generic warning", async () => {
  await expect(signOutAction(true)).rejects.toThrow("redirect");
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(mocks.redirect).toHaveBeenCalledWith("/?deviceCleanup=incomplete");
  expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.redirect.mock.invocationCallOrder[0],
  );
});

it("uses the ordinary destination when cleanup was not reported incomplete", async () => {
  mocks.redirect.mockClear();
  await expect(signOutAction(false)).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith("/");
});
