import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LiveManifestCoordinator,
  type LiveManifestRead,
  type LiveManifestScope,
  type LiveManifestTransport,
  manifestPrivacyGeneration,
  manifestSessionGeneration,
  reportManifestSessionInvalidation,
  reportPossibleManifestErasure,
} from "./live-manifest-read";

type View = { roster: string[]; count: number; print: string[]; causal: string[] };
let scope: LiveManifestScope;
let nextSession = 0;
beforeEach(() => {
  scope = {
    shopId: "shop-1",
    tripId: "trip-1",
    checkpoint: "departure",
    sessionId: `session-${++nextSession}`,
  };
});
const nonceA = "11111111-1111-4111-8111-111111111111";
const nonceB = "22222222-2222-4222-8222-222222222222";
const cached: View = { roster: ["A"], count: 1, print: ["A"], causal: ["event-a"] };
const fresh: View = { roster: ["A", "B"], count: 2, print: ["A", "B"], causal: ["event-b"] };
const result = (view: View, nonce = nonceA): LiveManifestRead<View> => ({
  view,
  nonce,
  scope,
  proof: "bound-proof",
});

const owners = new Set<LiveManifestCoordinator<View>>();
function owner(
  ownerScope: LiveManifestScope,
  cache: {
    scope: LiveManifestScope;
    view: View;
    privacyGeneration?: number;
    sessionGeneration?: number;
  } | null,
  transport: LiveManifestTransport<View>,
) {
  const coordinator = new LiveManifestCoordinator(
    ownerScope,
    cache
      ? {
          ...cache,
          privacyGeneration:
            cache.privacyGeneration ?? manifestPrivacyGeneration(cache.scope.shopId),
          sessionGeneration:
            cache.sessionGeneration ?? manifestSessionGeneration(cache.scope.sessionId),
        }
      : null,
    transport,
  );
  coordinator.activate();
  owners.add(coordinator);
  return coordinator;
}
afterEach(() => {
  for (const coordinator of owners) coordinator.dispose();
  owners.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("live manifest identity and privacy coordination", () => {
  it("hides another old-session owner and rejects its late verifier on session replacement", async () => {
    const oldGeneration = manifestSessionGeneration(scope.sessionId);
    const proof = deferred<"verified">();
    const verify = vi
      .fn<LiveManifestTransport<View>["verify"]>()
      .mockResolvedValueOnce("verified")
      .mockReturnValueOnce(proof.promise);
    const peerScope = { ...scope, shopId: "other-shop", tripId: "trip-2" };
    const peer = owner(
      peerScope,
      { scope: peerScope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: { ...result(fresh), scope: peerScope } }),
        verify,
      },
    );
    await peer.read();
    const commitId = peer.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    const pending = peer.acknowledgeCommit(commitId);
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    reportManifestSessionInvalidation(scope.sessionId);
    first.changeScope({ ...scope, sessionId: `${scope.sessionId}-replacement` });
    proof.resolve("verified");
    await pending;
    expect(peer.state.view).toBeNull();
    expect(peer.state.status).toBe("unconfirmed");
    const recreated = owner(
      peerScope,
      { scope: peerScope, view: cached, sessionGeneration: oldGeneration },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    expect(recreated.state.view).toBeNull();
  });

  it("cannot reread an invalidated session while signout is still in flight", async () => {
    const read = vi.fn(async () => ({ kind: "ready" as const, read: result(fresh) }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read,
        verify: async () => "verified",
      },
    );
    reportManifestSessionInvalidation(scope.sessionId);
    await coordinator.resume();
    reportPossibleManifestErasure(scope.shopId);
    await coordinator.read();
    expect(read).not.toHaveBeenCalled();
    expect(coordinator.state.view).toBeNull();
    expect(coordinator.state.status).toBe("unconfirmed");
  });

  it("propagates an authoritative unauthorized response to peer owners", async () => {
    const peer = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({ kind: "unauthorized" }),
        verify: async () => "unavailable",
      },
    );
    await first.read();
    expect(first.state.view).toBeNull();
    expect(peer.state.view).toBeNull();
    expect(peer.state.status).toBe("unconfirmed");
  });

  it("withdraws peer views if a response arrives under a different session", async () => {
    const peer = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(fresh) }),
        verify: async () => "verified",
      },
    );
    await peer.read();
    const commitId = peer.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    await peer.acknowledgeCommit(commitId);
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({
          kind: "ready",
          read: { ...result(fresh, nonceB), scope: { ...scope, sessionId: "replacement" } },
        }),
        verify: async () => "verified",
      },
    );
    await first.read();
    expect(peer.state.view).toBeNull();
    expect(peer.state.status).toBe("unconfirmed");
  });

  it("does not invalidate a peer from an unverified different-session response", async () => {
    const peer = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(fresh) }),
        verify: async () => "verified",
      },
    );
    await peer.read();
    const commitId = peer.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    await peer.acknowledgeCommit(commitId);
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({
          kind: "ready",
          read: { ...result(fresh, nonceB), scope: { ...scope, sessionId: "replacement" } },
        }),
        verify: async () => "unavailable",
      },
    );
    await first.read();
    expect(first.state.view).toBeNull();
    expect(peer.state.status).toBe("confirmed");
  });

  it("propagates a late old-session unauthorized response after its owner is disposed", async () => {
    const held = deferred<{ kind: "unauthorized" }>();
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: () => held.promise,
        verify: async () => "unavailable",
      },
    );
    const pending = first.read();
    first.dispose();
    const peer = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    held.resolve({ kind: "unauthorized" });
    await pending;
    expect(peer.state.view).toBeNull();
    expect(peer.state.status).toBe("unconfirmed");
  });

  it("propagates a late possible erasure after its originating owner is disposed", async () => {
    const held = deferred<{ kind: "possible-erasure" }>();
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: () => held.promise,
        verify: async () => "unavailable",
      },
    );
    const pending = first.read();
    first.dispose();
    const peer = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    held.resolve({ kind: "possible-erasure" });
    await pending;
    expect(peer.state.view).toBeNull();
    expect(peer.state.status).not.toBe("confirmed");
  });

  it.each(["unauthorized", "possible-erasure"] as const)(
    "propagates a %s read refusal arriving after timeout and disposal",
    async (refusal) => {
      vi.useFakeTimers();
      try {
        const held = deferred<{ kind: typeof refusal }>();
        const first = owner(
          scope,
          { scope, view: cached },
          {
            nonce: () => nonceA,
            read: () => held.promise,
            verify: async () => "unavailable",
          },
        );
        const pending = first.read();
        await vi.advanceTimersByTimeAsync(10_000);
        await pending;
        first.dispose();
        const peer = owner(
          scope,
          { scope, view: cached },
          {
            nonce: () => nonceB,
            read: async () => ({ kind: "unavailable" }),
            verify: async () => "unavailable",
          },
        );
        held.resolve({ kind: refusal });
        await Promise.resolve();
        expect(peer.state.view).toBeNull();
        expect(peer.state.status).not.toBe("confirmed");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("propagates a verification refusal arriving after timeout", async () => {
    vi.useFakeTimers();
    try {
      const held = deferred<"unauthorized">();
      const first = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceA,
          read: async () => ({ kind: "ready", read: result(fresh) }),
          verify: () => held.promise,
        },
      );
      const pending = first.read();
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      first.dispose();
      const peer = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceB,
          read: async () => ({ kind: "unavailable" }),
          verify: async () => "unavailable",
        },
      );
      held.resolve("unauthorized");
      await Promise.resolve();
      expect(peer.state.view).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates the old session when a replacement proof arrives after timeout", async () => {
    vi.useFakeTimers();
    try {
      const held = deferred<"verified">();
      const first = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceA,
          read: async () => ({
            kind: "ready",
            read: { ...result(fresh), scope: { ...scope, sessionId: "replacement" } },
          }),
          verify: () => held.promise,
        },
      );
      const pending = first.read();
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      first.dispose();
      const peer = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceB,
          read: async () => ({ kind: "unavailable" }),
          verify: async () => "unavailable",
        },
      );
      held.resolve("verified");
      await Promise.resolve();
      expect(peer.state.view).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invalidate peer sessions for a replacement response with the wrong nonce", async () => {
    const verify = vi.fn(async () => "verified" as const);
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({
          kind: "ready",
          read: { ...result(fresh, nonceB), scope: { ...scope, sessionId: "replacement" } },
        }),
        verify,
      },
    );
    const peer = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    await first.read();
    expect(verify).not.toHaveBeenCalled();
    expect(peer.state.view).toEqual(cached);
  });

  it("hides an abandoned cached view if the shop is invalidated before activation", () => {
    const generation = manifestPrivacyGeneration(scope.shopId);
    const transport: LiveManifestTransport<View> = {
      nonce: () => nonceA,
      read: async () => ({ kind: "unavailable" }),
      verify: async () => "unavailable",
    };
    const abandoned = new LiveManifestCoordinator(
      scope,
      {
        scope,
        view: cached,
        privacyGeneration: generation,
        sessionGeneration: manifestSessionGeneration(scope.sessionId),
      },
      transport,
    );
    const active = owner(scope, { scope, view: cached }, transport);
    active.purge();
    expect(abandoned.state.view).toBeNull();
    abandoned.activate();
    expect(abandoned.state.view).toBeNull();
    abandoned.dispose();
  });

  it("does not revive a disposed owner or retain an abandoned render's watcher", async () => {
    const read = vi.fn(async (nonce: string) => ({
      kind: "ready" as const,
      read: result(fresh, nonce),
    }));
    const transport = { nonce: () => nonceA, read, verify: async () => "verified" as const };
    const abandoned = new LiveManifestCoordinator(
      scope,
      {
        scope,
        view: cached,
        privacyGeneration: manifestPrivacyGeneration(scope.shopId),
        sessionGeneration: manifestSessionGeneration(scope.sessionId),
      },
      transport,
    );
    const listener = vi.fn();
    abandoned.subscribe(listener);
    const active = owner(scope, { scope, view: cached }, transport);
    const finish = active.beginMutation();
    expect(listener).not.toHaveBeenCalled();
    abandoned.dispose();
    await abandoned.resume();
    expect(read).not.toHaveBeenCalled();
    finish();
  });

  it("fences other owners and releases the write even when a subscriber throws", async () => {
    const read = vi.fn(async (nonce: string) => ({
      kind: "ready" as const,
      read: result(fresh, nonce),
    }));
    const transport = { nonce: () => nonceA, read, verify: async () => "verified" as const };
    const first = owner(scope, { scope, view: cached }, transport);
    const second = owner(scope, { scope, view: cached }, transport);
    first.subscribe(() => {
      throw new Error("broken consumer");
    });
    const finish = first.beginMutation();
    await second.read();
    expect(read).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
  });

  it("retries one possible-erasure refusal without looping on a second refusal", async () => {
    const read = vi.fn(async () => ({ kind: "possible-erasure" as const }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: vi.fn().mockReturnValueOnce(nonceA).mockReturnValueOnce(nonceB),
        read,
        verify: async () => "verified",
      },
    );
    await coordinator.read();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(coordinator.state.view).toBeNull();
    expect(coordinator.state.status).toBe("unconfirmed");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("retains a stale obligation while hidden and reads on reactivation", async () => {
    const read = vi.fn(async () => ({ kind: "ready" as const, read: result(fresh) }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read,
        verify: async () => "verified",
      },
    );
    coordinator.interrupt();
    coordinator.stale(true);
    expect(read).not.toHaveBeenCalled();
    expect(coordinator.state.view).toBeNull();
    await coordinator.resume();
    expect(read).toHaveBeenCalledTimes(1);
    expect(coordinator.state.status).toBe("unconfirmed");
    expect(coordinator.state.view).toEqual(fresh);
  });

  it("withdraws confirmation when a later nonce cannot be created", async () => {
    const nonce = vi
      .fn()
      .mockReturnValueOnce(nonceA)
      .mockImplementationOnce(() => {
        throw new Error("crypto unavailable");
      });
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce,
        read: async () => ({ kind: "ready", read: result(fresh) }),
        verify: async () => "verified",
      },
    );
    await coordinator.read();
    const commitId = coordinator.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    await coordinator.acknowledgeCommit(commitId);
    expect(coordinator.state.status).toBe("confirmed");
    coordinator.interrupt();
    await coordinator.resume();
    expect(coordinator.state.status).toBe("unconfirmed");
    expect(coordinator.state.view).toEqual(fresh);
  });

  it("copies the verified view so later in-place mutation cannot change it", async () => {
    const input: View = { roster: ["A"], count: 1, print: ["A"], causal: ["event-a"] };
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(input) }),
        verify: async () => "verified",
      },
    );
    await coordinator.read();
    input.roster.push("erased");
    expect(coordinator.state.view?.roster).toEqual(["A"]);
    expect(() => coordinator.state.view?.roster.push("unsafe")).toThrow();
  });

  it("coalesces reads until all distinct writes settle, including duplicate completion", async () => {
    const read = vi.fn(async () => ({ kind: "ready" as const, read: result(fresh) }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read,
        verify: async () => "verified",
      },
    );
    const first = coordinator.beginMutation();
    const second = coordinator.beginMutation();
    await coordinator.read();
    first();
    first();
    expect(read).not.toHaveBeenCalled();
    second();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  });

  it("times out an unanswered read and ignores its eventual response", async () => {
    vi.useFakeTimers();
    try {
      const held = deferred<{ kind: "ready"; read: LiveManifestRead<View> }>();
      const coordinator = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceA,
          read: () => held.promise,
          verify: async () => "verified",
        },
      );
      const pending = coordinator.read();
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      held.resolve({ kind: "ready", read: result(fresh) });
      await Promise.resolve();
      expect(coordinator.state).toEqual({ view: cached, status: "unconfirmed", commitId: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires confirmation and requires a new read", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceA,
          read: async () => ({ kind: "ready", read: result(fresh) }),
          verify: async () => "verified",
        },
      );
      await coordinator.read();
      const commitId = coordinator.state.commitId;
      if (commitId === null) throw new Error("missing commit");
      await coordinator.acknowledgeCommit(commitId);
      expect(coordinator.state.status).toBe("confirmed");
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(coordinator.state.status).toBe("unconfirmed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a UI acknowledgement delayed beyond the age of the original read", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceA,
          read: async () => ({ kind: "ready", read: result(fresh) }),
          verify: async () => "verified",
        },
      );
      await coordinator.read();
      const commitId = coordinator.state.commitId;
      if (commitId === null) throw new Error("missing commit");
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await coordinator.acknowledgeCommit(commitId);
      expect(coordinator.state.status).toBe("unconfirmed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not treat a sleeping device's old response as a recent read", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
      const coordinator = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceA,
          read: async () => ({ kind: "ready", read: result(fresh) }),
          verify: async () => "verified",
        },
      );
      await coordinator.read();
      const commitId = coordinator.state.commitId;
      if (commitId === null) throw new Error("missing commit");
      vi.setSystemTime(new Date("2026-11-13T12:06:00Z"));
      await coordinator.acknowledgeCommit(commitId);
      expect(coordinator.state.status).toBe("unconfirmed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides on malformed transport outcomes instead of treating them as offline", async () => {
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "forbidden" }) as never,
        verify: async () => "verified",
      },
    );
    await coordinator.read();
    expect(coordinator.state).toEqual({ view: null, status: "unconfirmed", commitId: null });
  });

  it("withdraws confirmation when the clock moves backwards", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
      const coordinator = owner(
        scope,
        { scope, view: cached },
        {
          nonce: () => nonceA,
          read: async () => ({ kind: "ready", read: result(fresh) }),
          verify: async () => "verified",
        },
      );
      await coordinator.read();
      const commitId = coordinator.state.commitId;
      if (commitId === null) throw new Error("missing commit");
      await coordinator.acknowledgeCommit(commitId);
      coordinator.recheckFreshness(Date.now() - 1);
      expect(coordinator.state.status).toBe("unconfirmed");
    } finally {
      vi.useRealTimers();
    }
  });
});
