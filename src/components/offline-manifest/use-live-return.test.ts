// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_ATTEMPT_TIMEOUT_MS, LIVE_RETRY_MS, useLiveAnswering } from "./use-live-return";
import { setOnline } from "./view-fixtures";

const LIVE = "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_1";
const WORKER_NAVIGATION_DEADLINE_MS = 4_000;
const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>();
const hung = () => new Promise<Response>(() => {});

/** What a server that has started answering again sends back. */
const answered = (init: { status?: number; redirected?: boolean } = {}) =>
  Object.defineProperty(new Response("live", { status: init.status ?? 200 }), "redirected", {
    value: init.redirected ?? false,
  });

/** A server that answers every ask, but only after `ms`. */
const answersAfter = (ms: number) => () =>
  new Promise<Response>((resolve) => {
    setTimeout(() => resolve(answered()), ms);
  });

/** Time passes, and React applies what the hook set meanwhile. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Captain review B1, re-review R1: the worker swaps in the saved copy when
 * the live manifest is merely slow, and the browser never fires `online` for
 * a device that never went offline. The copy asks on its own, and only says
 * whether DiveDay answered: the captain chooses when to leave.
 */
describe("useLiveAnswering", () => {
  it("keeps asking the live manifest, and says so the first time it answers", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    fetchMock.mockImplementationOnce(async () => answered({ status: 503 }));
    fetchMock.mockImplementation(async () => answered());
    const { result } = renderHook(() => useLiveAnswering(LIVE));

    await advance(LIVE_RETRY_MS);
    await advance(LIVE_RETRY_MS);
    expect(result.current).toBe(false);
    await advance(LIVE_RETRY_MS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(LIVE);
    expect(result.current).toBe(true);
  });

  it("budgets each ask under the worker's navigation deadline", () => {
    expect(LIVE_ATTEMPT_TIMEOUT_MS).toBeLessThan(WORKER_NAVIGATION_DEADLINE_MS);
  });

  it("never offers the live manifest from a server answering in a steady five seconds", async () => {
    // The worker would cut the navigation at four: an offer here would bounce
    // the captain straight back to the copy, every time.
    fetchMock.mockImplementation(answersAfter(5_000));
    const { result } = renderHook(() => useLiveAnswering(LIVE));
    const seen: boolean[] = [];

    for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
      await advance(500);
      seen.push(result.current);
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(seen.every((answering) => !answering)).toBe(true);
    for (const [, init] of fetchMock.mock.calls) expect(init?.signal?.aborted).toBe(true);
  });

  it("counts an answer inside the budget, and takes it back when the next ask fails", async () => {
    fetchMock.mockImplementationOnce(answersAfter(LIVE_ATTEMPT_TIMEOUT_MS - 500));
    fetchMock.mockImplementation(hung);
    const { result } = renderHook(() => useLiveAnswering(LIVE));

    await advance(LIVE_RETRY_MS + LIVE_ATTEMPT_TIMEOUT_MS);
    expect(result.current).toBe(true);
    await advance(LIVE_RETRY_MS + LIVE_ATTEMPT_TIMEOUT_MS);

    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect(result.current).toBe(false);
  });

  it("does not take a redirect to sign-in for an answer", async () => {
    fetchMock.mockImplementation(async () => answered({ redirected: true }));
    const { result } = renderHook(() => useLiveAnswering(LIVE));

    await advance(LIVE_RETRY_MS * 3);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current).toBe(false);
  });

  it("asks nothing while the device itself says it is offline", async () => {
    setOnline(false);
    const { result } = renderHook(() => useLiveAnswering(LIVE));

    await advance(LIVE_RETRY_MS * 3);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it("asks nothing for a copy the captain opened, and stops when the page goes", async () => {
    fetchMock.mockImplementation(hung);
    const { result, rerender, unmount } = renderHook(
      ({ href }: { href: string | null }) => useLiveAnswering(href),
      { initialProps: { href: null as string | null } },
    );
    await advance(LIVE_RETRY_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBe(false);

    rerender({ href: LIVE });
    await advance(LIVE_RETRY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await advance(LIVE_RETRY_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
