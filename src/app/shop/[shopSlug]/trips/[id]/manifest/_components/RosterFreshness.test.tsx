import { expect, it, vi } from "vitest";
import { verifyRosterConfirmation } from "@/features/offline-manifest-snapshots";
import { staffTranslator } from "@/i18n/staff-messages";
import * as clock from "@/lib/clock";
import { RosterFreshness } from "./RosterFreshness";

it("retains the read-boundary timestamp even when the server child renders later", () => {
  const readCompletedAt = 1_794_581_040_000;
  const now = vi.spyOn(clock, "nowMs").mockReturnValue(readCompletedAt + 60_000);
  try {
    const tripId = "11111111-1111-4111-8111-111111111111";
    const rosterRead = "22222222-2222-4222-8222-222222222222";
    const renderId = "33333333-3333-4333-8333-333333333333";
    const sessionId = "session-one";
    const child = RosterFreshness({
      tripId,
      shop: { id: "shop-one", timezone: "America/New_York" },
      sessionId,
      read: { renderErasureEpoch: 4, readCompletedAt },
      locale: "en-US",
      rosterRead,
      renderId,
      checkpoint: "departure",
      t: staffTranslator("en-US"),
    });
    expect(child.props.readCompletedAt).toBe(readCompletedAt);
    expect(child.props.historyScope).not.toContain(sessionId);
    expect(
      verifyRosterConfirmation(
        {
          tripId,
          shopId: "shop-one",
          sessionId,
          nonce: rosterRead,
          renderId,
          erasureEpoch: 4,
          checkpoint: "departure",
          readCompletedAt,
        },
        child.props.renderProof,
      ),
    ).toBe(true);
  } finally {
    now.mockRestore();
  }
});
