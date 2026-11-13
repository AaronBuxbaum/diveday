// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invalidateManifestRead } from "@/components/manifest-stale-generation";
import { announceSessionInvalidation } from "@/components/session-invalidation";
import { ManifestRosterFreshness } from "./ManifestRosterFreshness";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const copy = { unconfirmed: "Roster not freshly confirmed", confirmed: "Roster checked" };

beforeEach(() => {
  router.refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  window.history.replaceState(null, "", "/manifest");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("withdraws confirmation on every stale claim without accepting an old verifier", async () => {
  let resolveProof!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveProof = resolve;
    }),
  );
  const page = render(<ManifestRosterFreshness tripId="trip-1" renderId="first" copy={copy} />);
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <ManifestRosterFreshness
      tripId="trip-1"
      renderId="first"
      renderToken={token}
      renderProof="proof"
      copy={copy}
    />,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  act(() => invalidateManifestRead("other-trip"));
  act(() => invalidateManifestRead("trip-1"));
  act(() => invalidateManifestRead("trip-1"));
  await act(async () => resolveProof(new Response(null, { status: 204 })));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(screen.queryByText(copy.confirmed)).toBeNull();
});

it("requires a later verified read after a confirmed roster becomes stale", async () => {
  const page = render(<ManifestRosterFreshness tripId="trip-1" renderId="first" copy={copy} />);
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const first = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <ManifestRosterFreshness
      tripId="trip-1"
      renderId="first"
      renderToken={first}
      renderProof="proof"
      copy={copy}
    />,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => window.dispatchEvent(new Event("offline")));
  act(() => invalidateManifestRead("trip-1"));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
  const second = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  expect(second).not.toBe(first);
  page.rerender(
    <ManifestRosterFreshness
      tripId="trip-1"
      renderId="second"
      renderToken={second}
      renderProof="new-proof"
      copy={copy}
    />,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
});

it("keeps an old verifier invalid across a hidden page, stale claim and return", async () => {
  let resolveOld!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const view = (mode: "visible" | "hidden", token?: string) => (
    <Activity mode={mode}>
      <ManifestRosterFreshness
        tripId="trip-1"
        renderId="render-one"
        renderToken={token}
        renderProof="proof"
        copy={copy}
      />
    </Activity>
  );
  const page = render(view("visible"));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const first = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(view("visible", first));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  page.rerender(view("hidden", first));
  act(() => invalidateManifestRead("trip-1"));
  page.rerender(view("visible", first));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
  await act(async () => resolveOld(new Response(null, { status: 204 })));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(screen.queryByText(copy.confirmed)).toBeNull();
});

it("does not confirm an old-session render when live verification refuses it", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderToken={undefined}
      renderProof={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderToken={token}
      renderProof="old-session-proof"
      copy={copy}
    />,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(screen.queryByText(copy.confirmed)).toBeNull();
});

it("does not mistake an HTML success response for confirmation", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("sign in", { status: 200 }));
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={token}
      copy={copy}
    />,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("ignores an older verification response after a new return", async () => {
  let resolveOld!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const page = render(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const first = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={first}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  page.rerender(
    <Activity mode="hidden">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={first}
        copy={copy}
      />
    </Activity>,
  );
  page.rerender(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={first}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
  await act(async () => resolveOld(new Response(null, { status: 204 })));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("withdraws confirmation when a different render arrives with the same request marker", async () => {
  const page = render(
    <ManifestRosterFreshness
      tripId="trip-1"
      renderProof="proof"
      renderId="first"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <ManifestRosterFreshness
      tripId="trip-1"
      renderProof="proof"
      renderId="first"
      renderToken={token}
      copy={copy}
    />,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
  page.rerender(
    <ManifestRosterFreshness
      tripId="trip-1"
      renderProof="proof"
      renderId="second"
      renderToken={token}
      copy={copy}
    />,
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("allows a fresh activation after a session invalidation only after live verification", async () => {
  const page = render(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  act(() => announceSessionInvalidation());
  page.rerender(
    <Activity mode="hidden">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
    </Activity>,
  );
  page.rerender(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
  const next = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  page.rerender(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={next}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
});

it("does not confirm a verifier that answers after its deadline", async () => {
  let answer!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  vi.useFakeTimers();
  try {
    page.rerender(
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={token}
        copy={copy}
      />,
    );
    act(() => vi.advanceTimersByTime(10_000));
    await act(async () => answer(new Response(null, { status: 204 })));
    expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the cached rows unconfirmed until the requested server render replaces them", async () => {
  const page = render(
    <>
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
      <p>Erased diver</p>
    </>,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Erased diver")).toBeVisible();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  expect(token).toBeTruthy();
  page.rerender(
    <>
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={token}
        copy={copy}
      />
      <p>New seat</p>
    </>,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
  expect(screen.queryByText("Erased diver")).not.toBeInTheDocument();
  expect(screen.getByText("New seat")).toBeVisible();
});

it("keeps an interrupted return unconfirmed and requests one read on each return", async () => {
  const page = render(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  page.rerender(
    <Activity mode="hidden">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
    </Activity>,
  );
  page.rerender(
    <Activity mode="visible">
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={undefined}
        copy={copy}
      />
    </Activity>,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("stays unconfirmed offline and retries on reconnect", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(router.refresh).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("does not confirm a response that arrives after the device goes offline", async () => {
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => window.dispatchEvent(new Event("offline")));
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={token}
      copy={copy}
    />,
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("does not confirm an in-flight response after this device changes session", async () => {
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  act(() => announceSessionInvalidation());
  act(() => window.dispatchEvent(new Event("online")));
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={token}
      copy={copy}
    />,
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(router.refresh).toHaveBeenCalledTimes(1);
});

it("invalidates an in-flight response when another tab changes session", async () => {
  let receiver: ((event: MessageEvent) => void) | null = null;
  class TestChannel {
    set onmessage(callback: ((event: MessageEvent) => void) | null) {
      receiver = callback;
    }
    close() {}
  }
  vi.stubGlobal("BroadcastChannel", TestChannel);
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  act(() => receiver?.(new MessageEvent("message", { data: "invalidate" })));
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={token}
      copy={copy}
    />,
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("withdraws confirmation if a different server render replaces the roster", async () => {
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={token}
      copy={copy}
    />,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken="older-response"
      copy={copy}
    />,
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("expires confirmation even if no further render arrives", async () => {
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const token = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  vi.useFakeTimers();
  try {
    page.rerender(
      <ManifestRosterFreshness
        renderId="render-one"
        tripId="trip-1"
        renderProof="proof"
        renderToken={token}
        copy={copy}
      />,
    );
    await act(async () => {});
    expect(screen.getByText(copy.confirmed)).toBeVisible();
    act(() => vi.advanceTimersByTime(5 * 60 * 1000));
    expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it("requests confirmation again when reconciliation replaces a checked roster", async () => {
  const page = render(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  const first = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={first}
      copy={copy}
    />,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={undefined}
      copy={copy}
    />,
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(2));
  const second = new URLSearchParams(window.location.search).get("rosterRead") ?? undefined;
  expect(second).not.toBe(first);
  page.rerender(
    <ManifestRosterFreshness
      renderId="render-one"
      tripId="trip-1"
      renderProof="proof"
      renderToken={second}
      copy={copy}
    />,
  );
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
});
