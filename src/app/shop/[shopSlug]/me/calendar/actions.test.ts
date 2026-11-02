// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { staffSession } from "@/test/staff-session";

/**
 * **A scope the panel never offers mints nothing.** Whose calendar a feed is
 * comes from the session; the scope is the one thing the form controls, so
 * anything outside the two it offers is a refusal before the database is
 * touched — `getDb` throws below, so a lost guard fails loudly.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/features/calendar-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/calendar-sync")>();
  return { ...actual, revokeCalendarFeeds: vi.fn(async () => undefined) };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { revokeCalendarFeeds } = await import("@/features/calendar-sync");
const { calendarFeedAction } = await import("./actions");

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("calendarFeedAction", () => {
  it.each([
    ["a scope it does not offer", form([["scope", "everyone"]])],
    ["no scope at all", form([["intent", "revoke"]])],
  ])("refuses %s without reaching the database", async (_label, data) => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("a refused feed must not reach the database");
    });
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: "11111111-1111-4111-8111-111111111111",
        shopSlug: "reef-life",
        personId: "22222222-2222-4222-8222-222222222222",
      }),
    );

    expect(await calendarFeedAction({ status: "idle" }, data)).toEqual({ status: "denied" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("revokes from the panel's turn-off form, which carries no rotating flag", async () => {
    // The revoke form posts only intent and scope. Regression: zod refuses a
    // missing key even for `unknown`, which read every turn-off as denied.
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(requireStaffSession).mockResolvedValue(
      staffSession({
        shopId: "11111111-1111-4111-8111-111111111111",
        shopSlug: "reef-life",
        personId: "22222222-2222-4222-8222-222222222222",
      }),
    );

    const result = await calendarFeedAction(
      { status: "idle" },
      form([
        ["intent", "revoke"],
        ["scope", "assignments"],
      ]),
    );

    expect(result).toEqual({ status: "revoked", scope: "assignments" });
    expect(revokeCalendarFeeds).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ scope: "assignments" }),
    );
  });
});
