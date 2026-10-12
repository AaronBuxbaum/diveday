import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Undo on the roster's removal toast. It was an inline closure in `page.tsx`
 * that no test could import (2026-10-11 review, item 34). Restoring is the
 * inverse of the owner/manager-only deletion, so it takes the same gate.
 */

vi.mock("@/db/authz", () => ({ canPersonDeleteDiver: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({ db: "handle" })) }));
vi.mock("@/db/divers", () => ({ restoreDiver: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { canPersonDeleteDiver } = await import("@/db/authz");
const { restoreDiver } = await import("@/db/divers");
const { requireStaffSession } = await import("@/lib/session");
const { restoreDiverAction } = await import("./actions");

const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";

async function landing(fields: Record<string, string>): Promise<string> {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  try {
    await restoreDiverAction(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("expected restoreDiverAction to redirect");
}

beforeEach(() => {
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: "staff" },
  } as never);
  vi.mocked(canPersonDeleteDiver).mockResolvedValue(true);
  vi.mocked(restoreDiver).mockResolvedValue({ id: PERSON_ID } as never);
});

afterEach(() => vi.clearAllMocks());

describe("restoreDiverAction", () => {
  it("restores the diver in the session's shop and says so on the roster", async () => {
    expect(await landing({ personId: PERSON_ID })).toBe("/shop/blue-mantis/divers?notice=restored");
    expect(restoreDiver).toHaveBeenCalledWith({ db: "handle" }, SHOP_ID, PERSON_ID);
  });

  it("refuses a role that may not delete a diver, and restores nothing", async () => {
    vi.mocked(canPersonDeleteDiver).mockResolvedValue(false);
    expect(await landing({ personId: PERSON_ID })).toBe(
      "/shop/blue-mantis/divers?notice=not-authorized",
    );
    expect(canPersonDeleteDiver).toHaveBeenCalledWith({ db: "handle" }, SHOP_ID, "staff");
    expect(restoreDiver).not.toHaveBeenCalled();
  });

  it("says the restore was refused when the diver cannot come back", async () => {
    vi.mocked(restoreDiver).mockResolvedValue(null as never);
    expect(await landing({ personId: PERSON_ID })).toBe(
      "/shop/blue-mantis/divers?notice=restore-refused",
    );
  });

  it("refuses a post with no person without asking the database", async () => {
    expect(await landing({})).toBe("/shop/blue-mantis/divers?notice=restore-refused");
    expect(restoreDiver).not.toHaveBeenCalled();
  });
});
