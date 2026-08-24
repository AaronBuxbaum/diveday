import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { seededShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

/**
 * **`switchDemoRoleAction` takes a role string from an unauthenticated caller.**
 *
 * It used to cast that string straight into `eq(personRoles.role, …)`. Anything
 * outside the `person_role` enum reached Postgres as an invalid enum literal —
 * a driver error out of an action that needs no session, i.e. an unauthenticated
 * 500. Pre-existing and incidental to the change that found it, fixed here.
 *
 * Runs against the real seeded demo shop and the real query, because the bug
 * only exists at the database boundary: a mocked db would happily accept
 * `"crew'; --"` and prove nothing.
 */

const hoisted = vi.hoisted(() => ({
  signInDiveDayCredentials: vi.fn(async () => ({})),
  signOut: vi.fn(async () => ({})),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  getAuth: vi.fn(async () => ({
    api: {
      signInDiveDayCredentials: hoisted.signInDiveDayCredentials,
      signOut: hoisted.signOut,
    },
  })),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { switchDemoRoleAction } = await import("./demo");

/** Where the action sent the caller, or the error it failed with instead. */
async function landing(role: string): Promise<string> {
  try {
    await switchDemoRoleAction(role, "blue-mantis");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("expected switchDemoRoleAction to redirect");
}

beforeEach(async () => {
  const { db } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  hoisted.signInDiveDayCredentials.mockReset().mockResolvedValue({});
});

describe("switchDemoRoleAction", () => {
  it.each([
    ["not_a_role", "a role this app has never had"],
    ["crew'; drop table people; --", "a SQL fragment"],
    ["", "an empty string"],
    ["OWNER", "the right role in the wrong case"],
    ["constructor", "a prototype-walking value"],
  ])("refuses %s (%s) back to the shop rather than 500ing", async (role) => {
    expect(await landing(role)).toBe("/shop/blue-mantis");
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("still switches to a role the shop actually staffs", async () => {
    await expect(landing("instructor")).resolves.toBe("/shop/blue-mantis");
    expect(hoisted.signInDiveDayCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ password: DEMO_BYPASS_PASSWORD }),
      }),
    );
  });
});
