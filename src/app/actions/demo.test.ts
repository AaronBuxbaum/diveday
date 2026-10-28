import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

const ctx = fileScopedShopContext();

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
  requireStaffSession: vi.fn(async () => ({
    user: { shopId: "", shopSlug: "blue-mantis" },
  })),
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
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, requireStaffSession: hoisted.requireStaffSession };
});
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { cookies } = await import("next/headers");
const { DEMO_SEAT_COOKIE, signDemoSeat } = await import("@/lib/demo-seat");
const { resetDemoAction, switchDemoRoleAction } = await import("./demo");
const { people, personRoles, trips, userAccounts } = await import("@/db/schema");

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

let shopId = "";

/** The caller's session, as `auth()` hands it back: signed in at `atShopId`. */
function signedInAt(atShopId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { shopId: atShopId } } as never);
}

beforeEach(async () => {
  const { db, shop } = ctx;
  shopId = shop.id;
  vi.mocked(getDb).mockResolvedValue(db);
  hoisted.requireStaffSession.mockReset().mockResolvedValue({
    user: { shopId, shopSlug: "blue-mantis" },
  });
  hoisted.signInDiveDayCredentials.mockReset().mockResolvedValue({});
  hoisted.signOut.mockReset().mockResolvedValue({});
  // The staff switches below are made by somebody already in blue-mantis, as
  // the banner's own taps are; the tests about strangers say otherwise.
  signedInAt(shopId);
  (await cookies()).delete(DEMO_SEAT_COOKIE);
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

  it("fails out loud, not by redirect, when the sign-in refuses the switch", async () => {
    // The banner reads any redirect as a switch that worked; a refusal that
    // redirected showed the visitor nothing.
    const { APIError } = await import("better-auth/api");
    hoisted.signInDiveDayCredentials.mockRejectedValueOnce(new APIError("UNAUTHORIZED"));
    await expect(switchDemoRoleAction("instructor", "blue-mantis")).rejects.toThrow(
      "The demo sign-in refused the role switch.",
    );
  });

  it("refuses a staff switch from somebody signed in at another shop", async () => {
    // A slug is all the action is given, and every demo shop's slug is three
    // dictionary words: a session elsewhere must not become this shop's owner.
    signedInAt("00000000-0000-4000-8000-000000000000");
    expect(await landing("owner")).toBe("/");
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("refuses a staff switch from a stranger with no session and no seat", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await landing("owner")).toBe("/");
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("refuses a seat signed for a different shop", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    (await cookies()).set(DEMO_SEAT_COOKIE, signDemoSeat("00000000-0000-4000-8000-000000000000"));
    expect(await landing("owner")).toBe("/");
    expect(hoisted.signInDiveDayCredentials).not.toHaveBeenCalled();
  });

  it("lets the visitor previewing as a diver switch back to staff", async () => {
    // The diver preview signs the session out, so the seat it leaves behind is
    // the only thing that says this browser was in this shop a moment ago.
    expect(await landing("diver")).toBe("/s/blue-mantis");
    expect(hoisted.signOut).toHaveBeenCalled();
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await landing("owner")).toBe("/shop/blue-mantis");
    expect(hoisted.signInDiveDayCredentials).toHaveBeenCalled();
  });
});

describe("resetDemoAction", () => {
  it("redirects with the success notice only after a guarded reset completes", async () => {
    await expect(resetDemoAction()).rejects.toThrow("REDIRECT:/shop/blue-mantis?reset=1");
  });

  it("uses a refusal notice and leaves the schedule untouched when a staff identity is real", async () => {
    const { db } = ctx;
    const [owner] = await db
      .select({ accountId: userAccounts.id })
      .from(userAccounts)
      .innerJoin(people, eq(people.id, userAccounts.personId))
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected a demo owner account");
    await db
      .update(userAccounts)
      .set({ email: "owner@real-shop.example" })
      .where(eq(userAccounts.id, owner.accountId));
    const tripsBefore = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shopId));

    await expect(resetDemoAction()).rejects.toThrow("REDIRECT:/shop/blue-mantis?reset=refused");

    const tripsAfter = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shopId));
    expect(tripsAfter).toEqual(tripsBefore);
  });
});
