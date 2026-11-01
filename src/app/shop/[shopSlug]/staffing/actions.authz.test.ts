import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirectedTo, staffSession } from "@/test/staff-session";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  canPersonManageStaffAccounts: vi.fn(),
  requireStaffSession: vi.fn(),
  createStaffShift: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/authz", () => ({
  canPersonManageStaffAccounts: mocks.canPersonManageStaffAccounts,
}));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/db/staffing", () => ({
  createStaffShift: mocks.createStaffShift,
  deleteStaffShift: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: mocks.requireStaffSession }));

const { createShiftAction } = await import("./actions");
const shopId = "11111111-1111-4111-8111-111111111111";
const personId = "22222222-2222-4222-8222-222222222222";
const shopSlug = "blue-mantis";
const week = "2026-11-02";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue({});
  mocks.canPersonManageStaffAccounts.mockResolvedValue(false);
  mocks.requireStaffSession.mockResolvedValue(
    staffSession({ shopId, shopSlug, personId, roles: ["owner"] }),
  );
});

describe("staffing shift action authorization", () => {
  it("rejects stale owner claims when the live manager check refuses", async () => {
    const form = new FormData();
    form.set("personId", personId);
    form.set("date", week);
    form.set("startTime", "07:00");
    form.set("endTime", "15:00");
    form.set("note", "");

    const destination = await redirectedTo(() => createShiftAction(week, form));

    expect(destination).toBe("/shop/blue-mantis/staffing?notice=not-authorized&week=2026-11-02");
    expect(mocks.canPersonManageStaffAccounts).toHaveBeenCalledWith({}, shopId, personId);
    expect(mocks.createStaffShift).not.toHaveBeenCalled();
  });
});
