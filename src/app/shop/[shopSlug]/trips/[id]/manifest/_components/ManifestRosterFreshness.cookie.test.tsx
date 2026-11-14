// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManifestRosterFreshness } from "./ManifestRosterFreshness";
import { manifestHistoryCookieName, readManifestHistoryCookie } from "./manifest-history-cookie";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const trip = "11111111-1111-4111-8111-111111111111";
const copy = { unconfirmed: "Not checked", confirmed: "Checked" };
beforeEach(() => {
  router.refresh.mockClear();
  window.history.replaceState(null, "", "/manifest?checkpoint=departure");
  // biome-ignore lint/suspicious/noDocumentCookie: reset the real browser cookie for this challenge test.
  document.cookie = `${manifestHistoryCookieName(trip)}=; Path=/; Max-Age=0`;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("requests a correlated refresh without modifying the URL or browser history", async () => {
  const replace = vi.spyOn(window.history, "replaceState");
  render(
    <ManifestRosterFreshness
      historyScope="scope-one"
      readCompletedAt={1_794_581_040_000}
      readCompletedLabel="read completed"
      tripId={trip}
      renderId="initial"
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  expect(replace).not.toHaveBeenCalled();
  expect(window.location.search).toBe("?checkpoint=departure");
  expect(readManifestHistoryCookie(document.cookie, trip)).toBeDefined();
});

it("refreshes but remains unconfirmed if the device refuses the challenge cookie", async () => {
  vi.spyOn(document, "cookie", "set").mockImplementation(() => {});
  render(
    <ManifestRosterFreshness
      historyScope="scope-one"
      readCompletedAt={1_794_581_040_000}
      readCompletedLabel="read completed"
      tripId={trip}
      renderId="initial"
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  expect(readManifestHistoryCookie(document.cookie, trip)).toBeUndefined();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("does not call a delayed server render freshly checked after the read deadline", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const page = render(
    <ManifestRosterFreshness
      historyScope="scope-one"
      readCompletedAt={1_794_581_040_000}
      readCompletedLabel="read completed"
      tripId={trip}
      renderId="initial"
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, trip);
  clock.mockReturnValue(10_101);
  page.rerender(
    <ManifestRosterFreshness
      historyScope="scope-one"
      readCompletedAt={1_794_581_040_000}
      readCompletedLabel="read completed"
      tripId={trip}
      renderId="new"
      renderToken={token}
      renderProof="proof"
      copy={copy}
    />,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("keeps an abort-ignoring verifier unconfirmed after the device sleeps past the deadline", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const page = render(
    <ManifestRosterFreshness
      historyScope="scope-one"
      readCompletedAt={1_794_581_040_000}
      readCompletedLabel="read completed"
      tripId={trip}
      renderId="initial"
      copy={copy}
    />,
  );
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, trip);
  page.rerender(
    <ManifestRosterFreshness
      historyScope="scope-one"
      readCompletedAt={1_794_581_040_000}
      readCompletedLabel="read completed"
      tripId={trip}
      renderId="new"
      renderToken={token}
      renderProof="proof"
      copy={copy}
    />,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  clock.mockReturnValue(10_101);
  await act(async () => respond(new Response(null, { status: 204 })));
  expect(screen.queryByText(copy.confirmed)).toBeNull();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});
