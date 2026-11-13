import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LiveManifestCoordinator,
  type LiveManifestRead,
  type LiveManifestScope,
  type LiveManifestTransport,
  manifestPrivacyGeneration,
  reportPossibleManifestErasure,
} from "./live-manifest-read";

type View = { roster: string[]; count: number; print: string[]; causal: string[] };
const scope = {
  shopId: "shop-1",
  tripId: "trip-1",
  checkpoint: "departure",
  sessionId: "session-1",
};
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
  cache: { scope: LiveManifestScope; view: View; privacyGeneration?: number } | null,
  transport: LiveManifestTransport<View>,
) {
  const coordinator = new LiveManifestCoordinator(
    ownerScope,
    cache
      ? {
          ...cache,
          privacyGeneration:
            cache.privacyGeneration ?? manifestPrivacyGeneration(cache.scope.shopId),
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

describe("live manifest read coordination", () => {
  it("keeps the cached view during a read and confirms only after the exact view commits", async () => {
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
    expect(coordinator.state).toEqual({ view: cached, status: "checking", commitId: null });
    held.resolve({ kind: "ready", read: result(fresh) });
    await pending;
    expect(coordinator.state.view).toEqual(fresh);
    expect(coordinator.state.status).toBe("unconfirmed");
    const commitId = coordinator.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    await coordinator.acknowledgeCommit(commitId - 1);
    expect(coordinator.state.status).toBe("unconfirmed");
    await coordinator.acknowledgeCommit(commitId);
    expect(coordinator.state.status).toBe("confirmed");
  });

  it("keeps cached data on an ordinary network or proof failure", async () => {
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(fresh) }),
        verify: async () => "unavailable",
      },
    );
    await coordinator.read();
    expect(coordinator.state).toEqual({ view: cached, status: "unconfirmed", commitId: null });
  });

  it("hides prior identity on signout, replacement, or possible erasure", async () => {
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "unauthorized" }),
        verify: async () => "verified",
      },
    );
    await coordinator.read();
    expect(coordinator.state.view).toBeNull();
    const other = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(fresh) }),
        verify: async () => "verified",
      },
    );
    other.changeScope({ ...scope, sessionId: "session-2" });
    expect(other.state.view).toBeNull();
    const erased = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "possible-erasure" }),
        verify: async () => "verified",
      },
    );
    await erased.read();
    expect(erased.state.view).toBeNull();
  });

  it("ignores a delayed proof and commit acknowledgement after a stale claim", async () => {
    const verification = deferred<"verified">();
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(fresh) }),
        verify: () => verification.promise,
      },
    );
    const pending = coordinator.read();
    await Promise.resolve();
    coordinator.invalidate(false);
    verification.resolve("verified");
    await pending;
    await coordinator.acknowledgeCommit(1);
    expect(coordinator.state).toEqual({ view: cached, status: "unconfirmed", commitId: null });
  });

  it("cannot confirm after a stale claim interrupts the post-commit session check", async () => {
    const second = deferred<"verified">();
    const verify = vi
      .fn<LiveManifestTransport<View>["verify"]>()
      .mockResolvedValueOnce("verified")
      .mockReturnValueOnce(second.promise);
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(fresh) }),
        verify,
      },
    );
    await coordinator.read();
    const commitId = coordinator.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    const pending = coordinator.acknowledgeCommit(commitId);
    coordinator.invalidate(true);
    second.resolve("verified");
    await pending;
    expect(coordinator.state).toEqual({ view: null, status: "unconfirmed", commitId: null });
  });

  it("does not restore an erased person when interrupted after the new view commits", async () => {
    const oldView: View = { roster: ["A", "Erased"], count: 2, print: ["A", "Erased"], causal: [] };
    const newView: View = { roster: ["A"], count: 1, print: ["A"], causal: [] };
    const proof = deferred<"verified">();
    const verify = vi
      .fn<LiveManifestTransport<View>["verify"]>()
      .mockResolvedValueOnce("verified")
      .mockReturnValueOnce(proof.promise);
    const coordinator = owner(
      scope,
      { scope, view: oldView },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: result(newView) }),
        verify,
      },
    );
    await coordinator.read();
    const commitId = coordinator.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    const pending = coordinator.acknowledgeCommit(commitId);
    coordinator.interrupt();
    proof.resolve("verified");
    await pending;
    expect(coordinator.state.view).toEqual(newView);
    expect(coordinator.state.status).toBe("unconfirmed");
  });

  it("never installs an old read over a local write, and keeps its cached view", async () => {
    const held = deferred<{ kind: "ready"; read: LiveManifestRead<View> }>();
    const read = vi.fn(() => held.promise);
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read,
        verify: async () => "verified",
      },
    );
    const pending = coordinator.read();
    const finish = coordinator.beginMutation();
    await coordinator.read();
    expect(read).toHaveBeenCalledTimes(1);
    held.resolve({ kind: "ready", read: result(fresh) });
    await pending;
    expect(coordinator.state).toEqual({ view: cached, status: "unconfirmed", commitId: null });
    finish();
  });

  it("rolls back an uncommitted candidate before a local write begins", async () => {
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
    expect(coordinator.state.view).toEqual(fresh);
    const oldCommit = coordinator.state.commitId;
    if (oldCommit === null) throw new Error("missing commit");
    const finish = coordinator.beginMutation();
    expect(coordinator.state.view).toEqual(cached);
    await coordinator.acknowledgeCommit(oldCommit);
    expect(coordinator.state.status).toBe("unconfirmed");
    finish();
  });

  it("keeps same-trip mutations distinct across a session change", async () => {
    const nextScope = { ...scope, sessionId: "session-2" };
    const read = vi.fn(async (nonce: string) => ({
      kind: "ready" as const,
      read: { ...result(fresh, nonce), scope: nextScope },
    }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read,
        verify: async () => "verified",
      },
    );
    const finishOld = coordinator.beginMutation();
    coordinator.changeScope(nextScope);
    const finishNew = coordinator.beginMutation();
    finishOld();
    await coordinator.resume();
    expect(read).not.toHaveBeenCalled();
    finishNew();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  });

  it("never exposes a cached view belonging to another or absent identity", async () => {
    const read = vi.fn(async () => ({ kind: "ready" as const, read: result(fresh) }));
    const transport = { nonce: () => nonceA, read, verify: async () => "verified" as const };
    const wrong = owner({ ...scope, sessionId: "session-2" }, { scope, view: cached }, transport);
    expect(wrong.state.view).toBeNull();
    const signedOut = owner({ ...scope, sessionId: "" }, { scope, view: cached }, transport);
    await signedOut.read();
    expect(signedOut.state.view).toBeNull();
    expect(read).not.toHaveBeenCalled();
    const otherTrip = owner({ ...scope, tripId: "trip-2" }, { scope, view: cached }, transport);
    const otherCheckpoint = owner(
      { ...scope, checkpoint: "after_dive_1" },
      { scope, view: cached },
      transport,
    );
    expect(otherTrip.state.view).toBeNull();
    expect(otherCheckpoint.state.view).toBeNull();
  });

  it("never reuses a nonce, including after an intervening successful read", async () => {
    const nonce = vi
      .fn()
      .mockReturnValueOnce(nonceA)
      .mockReturnValueOnce(nonceB)
      .mockReturnValueOnce(nonceA);
    const read = vi.fn(async (value: string) => ({
      kind: "ready" as const,
      read: result(fresh, value),
    }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce,
        read,
        verify: async () => "verified",
      },
    );
    await coordinator.read();
    const first = coordinator.state.commitId;
    if (first === null) throw new Error("missing commit");
    await coordinator.acknowledgeCommit(first);
    coordinator.interrupt();
    await coordinator.resume();
    const second = coordinator.state.commitId;
    if (second === null) throw new Error("missing commit");
    await coordinator.acknowledgeCommit(second);
    coordinator.interrupt();
    await coordinator.resume();
    expect(read).toHaveBeenCalledTimes(2);
    expect(coordinator.state.status).toBe("unconfirmed");
  });

  it("coalesces simultaneous resume calls and retains a stale reread through a mutation", async () => {
    const held = deferred<{ kind: "ready"; read: LiveManifestRead<View> }>();
    const read = vi
      .fn<LiveManifestTransport<View>["read"]>()
      .mockReturnValueOnce(held.promise)
      .mockImplementationOnce(async (value) => ({ kind: "ready", read: result(fresh, value) }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: vi.fn().mockReturnValueOnce(nonceA).mockReturnValueOnce(nonceB),
        read,
        verify: async () => "verified",
      },
    );
    coordinator.interrupt();
    const first = coordinator.resume();
    const second = coordinator.resume();
    expect(read).toHaveBeenCalledTimes(1);
    held.resolve({ kind: "ready", read: result(fresh) });
    await Promise.all([first, second]);

    const finish = coordinator.beginMutation();
    coordinator.stale(true);
    expect(coordinator.state.view).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(coordinator.state.status).not.toBe("confirmed");
  });

  it("starts a real read when resumed from a confirmed view", async () => {
    const read = vi.fn(async (nonce: string) => ({
      kind: "ready" as const,
      read: result(fresh, nonce),
    }));
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
    const commitId = coordinator.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    await coordinator.acknowledgeCommit(commitId);
    expect(coordinator.state.status).toBe("confirmed");
    await coordinator.resume();
    expect(read).toHaveBeenCalledTimes(2);
    expect(coordinator.state.status).toBe("unconfirmed");
  });

  it("purges a same-session view and ignores an old response", async () => {
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
    coordinator.purge();
    held.resolve({ kind: "ready", read: result(fresh) });
    await pending;
    expect(coordinator.state).toEqual({ view: null, status: "unconfirmed", commitId: null });
  });

  it("keeps a same-trip write barrier across purge and a session change", async () => {
    const nextScope = { ...scope, sessionId: "session-2" };
    const read = vi.fn(async (nonce: string) => ({
      kind: "ready" as const,
      read: { ...result(fresh, nonce), scope: nextScope },
    }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read,
        verify: async () => "verified",
      },
    );
    const finish = coordinator.beginMutation();
    coordinator.purge();
    coordinator.changeScope(nextScope);
    await coordinator.resume();
    expect(read).not.toHaveBeenCalled();
    expect(coordinator.state.view).toBeNull();
    finish();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  });

  it("keeps an unfinished trip A write fenced after navigating A to B and back", async () => {
    const read = vi.fn(async (nonce: string) => ({
      kind: "ready" as const,
      read: result(fresh, nonce),
    }));
    const coordinator = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read,
        verify: async () => "verified",
      },
    );
    const finishA = coordinator.beginMutation();
    coordinator.changeScope({ ...scope, tripId: "trip-2" });
    coordinator.changeScope(scope);
    await coordinator.resume();
    expect(read).not.toHaveBeenCalled();
    finishA();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  });

  it("keeps a write barrier after its original owner is disposed and recreated", async () => {
    const read = vi.fn(async (nonce: string) => ({
      kind: "ready" as const,
      read: result(fresh, nonce),
    }));
    const transport = { nonce: () => nonceA, read, verify: async () => "verified" as const };
    const original = owner(scope, { scope, view: cached }, transport);
    const finish = original.beginMutation();
    original.dispose();
    const replacement = owner(scope, { scope, view: cached }, transport);
    await replacement.resume();
    expect(read).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(replacement.state.status).not.toBe("confirmed");
  });

  it("hides other same-shop owners and rejects old cached views after a possible erasure", async () => {
    const before = manifestPrivacyGeneration(scope.shopId);
    const proof = deferred<"verified">();
    const verify = vi
      .fn<LiveManifestTransport<View>["verify"]>()
      .mockResolvedValueOnce("verified")
      .mockReturnValueOnce(proof.promise);
    const otherTrip = { ...scope, tripId: "trip-2" };
    const second = owner(
      otherTrip,
      { scope: otherTrip, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "ready", read: { ...result(fresh), scope: otherTrip } }),
        verify,
      },
    );
    await second.read();
    const commitId = second.state.commitId;
    if (commitId === null) throw new Error("missing commit");
    const pending = second.acknowledgeCommit(commitId);
    const first = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceB,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    first.stale(true);
    proof.resolve("verified");
    await pending;
    expect(second.state.view).toBeNull();
    expect(second.state.status).toBe("unconfirmed");
    const recreated = owner(
      scope,
      { scope, view: cached, privacyGeneration: before },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    expect(recreated.state.view).toBeNull();
    const otherShop = { ...scope, shopId: "other-shop" };
    const unaffected = owner(
      otherShop,
      { scope: otherShop, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    expect(unaffected.state.view).toEqual(cached);
  });

  it("reports a late possible-erasure refusal for the original shop after its owner is gone", async () => {
    const original = owner(
      scope,
      { scope, view: cached },
      {
        nonce: () => nonceA,
        read: async () => ({ kind: "unavailable" }),
        verify: async () => "unavailable",
      },
    );
    const report = () => reportPossibleManifestErasure(scope.shopId);
    original.changeScope({ ...scope, shopId: "different-shop" });
    original.dispose();
    const read = vi.fn(async () => ({ kind: "unavailable" as const }));
    const peerScope = { ...scope, tripId: "trip-2" };
    const peer = owner(
      peerScope,
      { scope: peerScope, view: cached },
      {
        nonce: () => nonceB,
        read,
        verify: async () => "unavailable",
      },
    );
    report();
    expect(peer.state.view).toBeNull();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(peer.state.status).not.toBe("confirmed");
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
      { scope, view: cached, privacyGeneration: generation },
      transport,
    );
    const active = owner(scope, { scope, view: cached }, transport);
    active.purge();
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
      { scope, view: cached, privacyGeneration: manifestPrivacyGeneration(scope.shopId) },
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
