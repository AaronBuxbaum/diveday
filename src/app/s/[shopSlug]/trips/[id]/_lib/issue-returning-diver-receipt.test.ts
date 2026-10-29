// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const { issueReceipt, setCookie } = vi.hoisted(() => ({
  issueReceipt: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: setCookie })) }));
vi.mock("@/db/booking-capabilities", () => ({
  issueReturningDiverReceipt: issueReceipt,
  RETURNING_DIVER_RECEIPT_TTL_MS: 24 * 60 * 60 * 1000,
}));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));
vi.mock("@/lib/returning-diver", () => ({
  RETURNING_DIVER_RECEIPT_COOKIE: "diveday-returning-diver-receipt",
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
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("returns within budget and never writes a late receipt cookie", async () => {
    vi.useFakeTimers();
    let completeLateIssue!: (receipt: {
      token: string;
      expiresAt: Date;
      memoryExpiresAt: number;
    }) => void;
    issueReceipt.mockReturnValue(
      new Promise((resolve) => {
        completeLateIssue = resolve;
      }),
    );

    const attempt = issueReturningDiverReceiptForBooking({} as never, issueInput());
    await vi.advanceTimersByTimeAsync(RETURNING_DIVER_RECEIPT_ISSUE_BUDGET_MS);
    await expect(attempt).resolves.toBeUndefined();
    expect(setCookie).not.toHaveBeenCalled();

    completeLateIssue({ token: "late-secret", expiresAt: new Date(), memoryExpiresAt: Date.now() });
    await Promise.resolve();
    await Promise.resolve();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("sets the scoped HttpOnly cookie when issuance completes within budget", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    issueReceipt.mockResolvedValue({
      token: "ready-secret",
      expiresAt,
      memoryExpiresAt: Date.now(),
    });

    await issueReturningDiverReceiptForBooking({} as never, issueInput());

    expect(setCookie).toHaveBeenCalledWith(
      "diveday-returning-diver-receipt",
      "ready-secret",
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
    );
  });
});
