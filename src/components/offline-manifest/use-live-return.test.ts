// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_ATTEMPT_TIMEOUT_MS, LIVE_RETRY_MS, useLiveReturn } from "./use-live-return";
import { setOnline } from "./view-fixtures";

const LIVE = "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_1";
const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>();
const hung = () => new Promise<Response>(() => {});

/** What a server that has started answering again sends back. */
const answered = (init: { status?: number; redirected?: boolean } = {}) =>
  Object.defineProperty(new Response("live", { status: init.status ?? 200 }), "redirected", {
    value: init.redirected ?? false,
  });

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
 * Captain review B1: the worker swaps in the saved copy when the live
 * manifest is merely slow, and the browser never fires `online` for a device
 * that never went offline. The copy has to find its own way back.
 */
describe("useLiveReturn", () => {
  it("keeps asking the live manifest, and opens it the first time it answers", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    fetchMock.mockImplementationOnce(async () => answered({ status: 503 }));
    fetchMock.mockImplementation(async () => answered());
    const open = vi.fn();
    renderHook(() => useLiveReturn(LIVE, () => true, open));

    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);
    expect(open).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(LIVE);
    expect(open).toHaveBeenCalledExactlyOnceWith(LIVE);
  });

  it("returns once a slow answer arrives, past the worker's four seconds", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const open = vi.fn();
    renderHook(() => useLiveReturn(LIVE, () => true, open));

    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS + 8_000);
    answer(answered());
    await vi.advanceTimersByTimeAsync(0);

    expect(open).toHaveBeenCalledExactlyOnceWith(LIVE);
  });

  it("gives up on one ask that never answers and asks again", async () => {
    fetchMock.mockImplementationOnce(hung);
    fetchMock.mockImplementation(async () => answered());
    const open = vi.fn();
    renderHook(() => useLiveReturn(LIVE, () => true, open));

    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS + LIVE_ATTEMPT_TIMEOUT_MS);
    const firstAsk = fetchMock.mock.calls[0]?.[1];
    expect(firstAsk?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);

    expect(open).toHaveBeenCalledExactlyOnceWith(LIVE);
  });

  it("does not take a redirect to sign-in for an answer", async () => {
    fetchMock.mockImplementation(async () => answered({ redirected: true }));
    const open = vi.fn();
    renderHook(() => useLiveReturn(LIVE, () => true, open));

    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(open).not.toHaveBeenCalled();
  });

  it("holds the captain on the copy while a tap or a typed sentence is mid-way", async () => {
    fetchMock.mockImplementation(async () => answered());
    const open = vi.fn();
    let busy = true;
    renderHook(() => useLiveReturn(LIVE, () => !busy, open));

    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 2);
    expect(open).not.toHaveBeenCalled();
    busy = false;
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);

    expect(open).toHaveBeenCalledExactlyOnceWith(LIVE);
  });

  it("asks nothing while the device itself says it is offline", async () => {
    setOnline(false);
    const open = vi.fn();
    renderHook(() => useLiveReturn(LIVE, () => true, open));

    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 3);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("asks nothing for a copy the captain opened, and stops when the page goes", async () => {
    fetchMock.mockImplementation(hung);
    const { rerender, unmount } = renderHook(
      ({ href }: { href: string | null }) => useLiveReturn(href, () => true, vi.fn()),
      { initialProps: { href: null as string | null } },
    );
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ href: LIVE });
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(LIVE_RETRY_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
