// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManifestRosterCommit } from "./ManifestRosterCommit";
import { ManifestRosterFreshness } from "./ManifestRosterFreshness";
import { readManifestHistoryCookie } from "./manifest-history-cookie";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const tripId = "11111111-1111-4111-8111-111111111111";
const copy = { unconfirmed: "Not checked", confirmed: "Checked" };
beforeEach(() => {
  router.refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for the matching rendered roster to commit after live confirmation", async () => {
  const view = (token?: string, marker = false) => (
    <>
      <ManifestRosterFreshness
        tripId={tripId}
        renderId="render"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        copy={copy}
      />
      {marker && (
        <ManifestRosterCommit
          tripId={tripId}
          renderId="render"
          renderToken={token}
          checkpoint="departure"
        />
      )}
    </>
  );
  const page = render(view());
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view(token));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  page.rerender(view(token, true));
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
});

it("accepts an exact roster commit that precedes the live verifier response", async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise<Response>((answer) => {
      resolve = answer;
    }),
  );
  const view = (token?: string) => (
    <>
      <ManifestRosterFreshness
        tripId={tripId}
        renderId="early"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        copy={copy}
      />
      <ManifestRosterCommit
        tripId={tripId}
        renderId="early"
        renderToken={token}
        checkpoint="departure"
      />
    </>
  );
  const page = render(view());
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view(token));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  await act(async () => resolve(new Response(null, { status: 204 })));
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
});

it("does not confirm a different checkpoint's committed roster", async () => {
  const view = (token?: string, markerCheckpoint = "after_dive_1") => (
    <>
      <ManifestRosterFreshness
        tripId={tripId}
        renderId="checkpoint"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        copy={copy}
      />
      <ManifestRosterCommit
        tripId={tripId}
        renderId="checkpoint"
        renderToken={token}
        checkpoint={markerCheckpoint}
      />
    </>
  );
  const page = render(view());
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view(token));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  page.rerender(view(token, "departure"));
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
});

it("does not confirm when the matching commit arrives after the read deadline", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  const view = (token?: string, marker = false) => (
    <>
      <ManifestRosterFreshness
        tripId={tripId}
        renderId="late"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        copy={copy}
      />
      {marker && (
        <ManifestRosterCommit
          tripId={tripId}
          renderId="late"
          renderToken={token}
          checkpoint="departure"
        />
      )}
    </>
  );
  const page = render(view());
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view(token));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await act(async () => {});
  clock.mockReturnValue(10_101);
  page.rerender(view(token, true));
  expect(screen.queryByText(copy.confirmed)).toBeNull();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});
