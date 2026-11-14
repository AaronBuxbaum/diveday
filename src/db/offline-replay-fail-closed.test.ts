import { describe, expect, it, vi } from "vitest";
import { answeringReplayAsDuplicate } from "./offline-replay";

const indexName = "roll_call_events_shop_client_event_unique";
const collision = () =>
  Object.assign(new Error("client event collision"), {
    code: "23505",
    constraint: indexName,
  });

describe("offline collision when a secure replay receipt is unavailable", () => {
  it("fails the request and leaves the client to retry instead of synthesizing a duplicate", async () => {
    const error = collision();
    const write = vi.fn().mockRejectedValue(error);
    const stored = vi.fn().mockResolvedValue({ id: "existing", subject: "trip/seat" });
    await expect(
      answeringReplayAsDuplicate(write, {
        indexName,
        clientEventId: "client-event",
        source: "offline",
        subject: "trip/seat",
        stored,
      }),
    ).rejects.toBe(error);
    expect(write).toHaveBeenCalledOnce();
    expect(stored).not.toHaveBeenCalled();
  });
});
