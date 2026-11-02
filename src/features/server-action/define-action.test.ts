// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { redirectedTo } from "@/test/staff-session";

const mocks = vi.hoisted(() => ({
  requireStaffSession: vi.fn(),
  getDb: vi.fn(async () => ({ db: "pool" })),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({ requireStaffSession: mocks.requireStaffSession }));

const { actionContext, defineAction, land } = await import("./define-action");
type ActionGate = import("./define-action").ActionGate;

const SHOP = { shopId: "shop-1", shopSlug: "reef life", personId: "person-1" };
const allow = vi.fn(async () => true);
const deny = vi.fn(async () => false);
const GATE_OPEN: ActionGate = {
  allow,
  refusal: { notice: "not-authorized", landing: ["settings"] },
};
const GATE_SHUT: ActionGate = { allow: deny, refusal: { notice: "settings-not-authorized" } };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStaffSession.mockResolvedValue({ user: { ...SHOP, roles: ["owner"] } });
});

describe("defineAction", () => {
  it("lands where run says, with the notice and extras, revalidating the pathname", async () => {
    const run = vi.fn(
      async ({ path }: { path: (...s: string[]) => string }, input: { n: string }) =>
        land(`${path("settings")}#units`, "units-saved", { extra: { saved: input.n } }),
    );
    const action = defineAction({ gate: "staff", input: z.object({ n: z.string() }), run });

    const to = await redirectedTo(() => action(form({ n: "units" })));

    expect(to).toBe("/shop/reef%20life/settings?notice=units-saved&saved=units#units");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/shop/reef%20life/settings");
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: "shop-1", personId: "person-1", db: { db: "pool" } }),
      { n: "units" },
    );
  });

  it("builds every path from the session's shop, never from anything posted", async () => {
    const action = defineAction({
      gate: "staff",
      input: z.object({ shopSlug: z.string() }),
      run: async ({ path }) => land(path("settings"), "saved"),
    });

    const to = await redirectedTo(() => action(form({ shopSlug: "../other-shop" })));

    expect(to).toBe("/shop/reef%20life/settings?notice=saved");
  });

  it("asks every gate in order before reading the form, and a refusal runs nothing", async () => {
    const run = vi.fn(async () => land("/x", "saved"));
    const action = defineAction({
      gate: [GATE_OPEN, GATE_SHUT, GATE_OPEN],
      input: z.object({ n: z.string() }),
      run,
    });

    // No `n`: the schema would refuse, so landing on the gate's refusal proves
    // the gates ran first.
    const to = await redirectedTo(() => action(form({})));

    expect(to).toBe("/shop/reef%20life?notice=settings-not-authorized");
    expect(allow).toHaveBeenCalledTimes(1);
    expect(allow).toHaveBeenCalledWith({ db: "pool" }, "shop-1", "person-1");
    expect(deny).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("lands a refused gate on its own landing under this shop", async () => {
    const shut: ActionGate = {
      allow: deny,
      refusal: { notice: "not-authorized", landing: ["settings"] },
    };
    const action = defineAction({ gate: [shut], run: async () => land("/x", "saved") });

    expect(await redirectedTo(() => action(form({})))).toBe(
      "/shop/reef%20life/settings?notice=not-authorized",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/shop/reef%20life/settings");
  });

  it("refuses a staffer the session gate refuses before any gate or read", async () => {
    mocks.requireStaffSession.mockRejectedValueOnce(new Error("REDIRECT:/sign-in"));
    const run = vi.fn(async () => land("/x", "saved"));
    const action = defineAction({ gate: [GATE_OPEN], run });

    expect(await redirectedTo(() => action(form({})))).toBe("/sign-in");
    expect(allow).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("lands a refused form on `invalid` when the declaration has one", async () => {
    const run = vi.fn(async () => land("/x", "saved"));
    const action = defineAction({
      gate: "staff",
      input: z.object({ email: z.email() }),
      invalid: ({ path }) => land(path("settings"), "contact-invalid", { extra: { saved: "c" } }),
      run,
    });

    expect(await redirectedTo(() => action(form({ email: "nope" })))).toBe(
      "/shop/reef%20life/settings?notice=contact-invalid&saved=c",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("throws on a refused form when the declaration has no `invalid`, as readForm does", async () => {
    const action = defineAction({
      gate: "staff",
      input: z.object({ n: z.string() }),
      run: async () => land("/x", "saved"),
    });

    await expect(action(form({}))).rejects.toThrow("form refused: n");
  });

  it("reads no field when it declares no input, and takes no form at all", async () => {
    const action = defineAction({
      gate: "staff",
      run: async ({ path }) => land(path("settings")),
    });

    expect(await redirectedTo(() => action())).toBe("/shop/reef%20life/settings");
  });

  it("revalidates the other pages a landing names", async () => {
    const action = defineAction({
      gate: "staff",
      run: async ({ path }) => land(path("settings"), "saved", { also: ["/s/reef-life"] }),
    });

    await redirectedTo(() => action());

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/s/reef-life");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/shop/reef%20life/settings");
  });

  it("refuses mid-run through `demand` exactly as a declared gate does", async () => {
    const write = vi.fn();
    const action = defineAction({
      gate: [GATE_OPEN],
      run: async ({ path, demand }) => {
        await demand(GATE_SHUT);
        write();
        return land(path("settings"), "saved");
      },
    });

    expect(await redirectedTo(() => action())).toBe(
      "/shop/reef%20life?notice=settings-not-authorized",
    );
    expect(write).not.toHaveBeenCalled();
  });
});

describe("actionContext", () => {
  it("resolves the session's shop once every gate passes", async () => {
    const ctx = await actionContext([GATE_OPEN]);

    expect(ctx).toMatchObject({ shopId: "shop-1", personId: "person-1", shopSlug: "reef life" });
    expect(ctx.path("settings", "rentals")).toBe("/shop/reef%20life/settings/rentals");
  });

  it("throws the refusal of the first gate that fails", async () => {
    expect(await redirectedTo(() => actionContext([GATE_SHUT]))).toBe(
      "/shop/reef%20life?notice=settings-not-authorized",
    );
  });
});

describe("land", () => {
  it("holds a code to its one kebab spelling at compile time", () => {
    // @ts-expect-error snake_case is not a notice code's spelling
    land("/x", "rentals_saved");
    // @ts-expect-error upper case is not either
    land("/x", "Rentals-Saved");
    expect(land("/x", "rentals-saved")).toEqual({
      path: "/x",
      notice: "rentals-saved",
      extra: undefined,
      also: undefined,
    });
  });
});
