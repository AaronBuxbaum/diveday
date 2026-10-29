// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const { issueReceipt } = vi.hoisted(() => ({ issueReceipt: vi.fn() }));

vi.mock("@/db/booking-capabilities", () => ({ issueReturningDiverReceipt: issueReceipt }));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));
vi.mock("@/lib/returning-diver", () => ({
  RETURNING_DIVER_DEVICE_TOKEN_PATTERN: /^[A-Za-z0-9_-]{40,128}$/,
}));

const { issueReturningDiverReceiptForBooking, RETURNING_DIVER_RECEIPT_ISSUE_BUDGET_MS } =
  await import("./issue-returning-diver-receipt");

function issueInput() {
  return {
    optedIn: true,
    embed: false,
    shopId: "shop",
    bookingId: "booking",
    tripId: "trip",
    confirmedBooking: {
      booking: { identityUnconfirmedAt: null, personId: "person" },
      person: { email: "diver@example.com" },
    } as never,
    redirectCapability: { token: "redirect-token", expiresAt: new Date() },
    deviceToken: "a".repeat(64),
    deviceGeneration: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("best-effort returning-diver receipt issuance", () => {
  it("does nothing when the diver did not opt in", async () => {
    await issueReturningDiverReceiptForBooking({} as never, { ...issueInput(), optedIn: false });
    expect(issueReceipt).not.toHaveBeenCalled();
  });

  it("does not wait for a late receipt after the post-booking budget", async () => {
    vi.useFakeTimers();
    issueReceipt.mockReturnValue(new Promise(() => {}));

    const attempt = issueReturningDiverReceiptForBooking({} as never, issueInput());
    await vi.advanceTimersByTimeAsync(RETURNING_DIVER_RECEIPT_ISSUE_BUDGET_MS);
    await expect(attempt).resolves.toBeUndefined();
    expect(issueReceipt).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ deviceToken: "a".repeat(64), deviceGeneration: null }),
    );
  });

  it("does not issue without a valid opt-in slot", async () => {
    await issueReturningDiverReceiptForBooking({} as never, {
      ...issueInput(),
      deviceToken: null,
    });
    expect(issueReceipt).not.toHaveBeenCalled();
  });
});
