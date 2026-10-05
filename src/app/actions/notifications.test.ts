import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/lib/session", () => ({
  requireStaffSession: vi.fn(async () => ({ user: { shopId: "shop-1", roles: ["owner"] } })),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/db/notifications", () => ({
  listNotificationDeliveryIssues: vi.fn(),
  retryBookingConfirmation: vi.fn(),
}));

const { listNotificationDeliveryIssues, retryBookingConfirmation } = await import(
  "@/db/notifications"
);
const { resendConfirmationAction } = await import("./notifications");

function issue(bookingId: string, kind = "booking_confirmation") {
  return { delivery: { kind }, booking: { id: bookingId } };
}

function form(...bookingIds: string[]): FormData {
  const data = new FormData();
  for (const id of bookingIds) data.append("bookingId", id);
  return data;
}

const idle = { status: "idle" } as const;

/**
 * **A batched resend sends only what the Today queue says failed.** The row
 * posts booking ids, and a post is something anybody signed in can forge: the
 * action re-derives the set from the failed deliveries, so an id the queue
 * never offered sends nothing (security-reviewer, 2026-10-05).
 */
describe("resendConfirmationAction", () => {
  beforeEach(() => {
    vi.mocked(listNotificationDeliveryIssues).mockReset();
    vi.mocked(retryBookingConfirmation).mockReset();
    vi.mocked(retryBookingConfirmation).mockResolvedValue({ status: "sent" } as never);
  });

  it("resends every failed confirmation a batched row stands for", async () => {
    vi.mocked(listNotificationDeliveryIssues).mockResolvedValue([
      issue("b1"),
      issue("b2"),
    ] as never);
    await expect(resendConfirmationAction("blue-mantis", idle, form("b1", "b2"))).resolves.toEqual({
      status: "sent",
    });
    expect(vi.mocked(retryBookingConfirmation).mock.calls.map((call) => call[2])).toEqual([
      "b1",
      "b2",
    ]);
  });

  it("skips an id with no failed confirmation, and a waiver link's failure", async () => {
    vi.mocked(listNotificationDeliveryIssues).mockResolvedValue([
      issue("b1"),
      issue("b2", "waiver_request"),
    ] as never);
    await resendConfirmationAction("blue-mantis", idle, form("b1", "b2", "forged"));
    expect(vi.mocked(retryBookingConfirmation).mock.calls.map((call) => call[2])).toEqual(["b1"]);
  });

  it("sends nothing when no posted id is on the failed list", async () => {
    vi.mocked(listNotificationDeliveryIssues).mockResolvedValue([] as never);
    await expect(resendConfirmationAction("blue-mantis", idle, form("forged"))).resolves.toEqual({
      status: "error",
      reason: "invalid",
    });
    expect(retryBookingConfirmation).not.toHaveBeenCalled();
  });

  it("refuses a post naming more bookings than a batch can hold, whole", async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `b${index}`);
    vi.mocked(listNotificationDeliveryIssues).mockResolvedValue(
      ids.map((id) => issue(id)) as never,
    );
    await expect(resendConfirmationAction("blue-mantis", idle, form(...ids))).resolves.toEqual({
      status: "error",
      reason: "invalid",
    });
    expect(retryBookingConfirmation).not.toHaveBeenCalled();
  });

  it("reports a failure when any one of the batch did not send", async () => {
    vi.mocked(listNotificationDeliveryIssues).mockResolvedValue([
      issue("b1"),
      issue("b2"),
    ] as never);
    vi.mocked(retryBookingConfirmation)
      .mockResolvedValueOnce({ status: "sent" } as never)
      .mockResolvedValueOnce({ status: "failed" } as never);
    await expect(resendConfirmationAction("blue-mantis", idle, form("b1", "b2"))).resolves.toEqual({
      status: "error",
      reason: "failed",
    });
  });
});
