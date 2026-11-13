// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { announceSessionInvalidation } from "@/components/session-invalidation";
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

it("shows the completed read time only after the matching roster is verified and committed", async () => {
  const label = "read completed Nov 13 at 9:42 AM EST";
  const view = (token?: string, marker = false) => (
    <>
      <ManifestRosterFreshness
        historyScope="scope-one"
        tripId={tripId}
        renderId="timed"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel={label}
        copy={copy}
      />
      {marker && (
        <ManifestRosterCommit
          tripId={tripId}
          renderId="timed"
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
  expect(screen.queryByText(label)).toBeNull();
  page.rerender(view(token, true));
  await waitFor(() => expect(screen.getByText(label)).toBeVisible());
});

it("keeps the last verified read time visible but unconfirmed after going offline", async () => {
  const label = "last read completed Nov 13 at 9:42 AM EST";
  const view = (token?: string) => (
    <>
      <ManifestRosterFreshness
        historyScope="scope-one"
        tripId={tripId}
        renderId="historical"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel={label}
        copy={copy}
      />
      <ManifestRosterCommit
        tripId={tripId}
        renderId="historical"
        renderToken={token}
        checkpoint="departure"
      />
    </>
  );
  const page = render(view());
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view(token));
  await waitFor(() => expect(screen.getByText(copy.confirmed)).toBeVisible());
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(screen.getByText(label)).toBeVisible();
  expect(screen.queryByText(copy.confirmed)).toBeNull();
});

it("does not carry a verified read time into another session scope", async () => {
  const label = "last read for the first session";
  const view = (scope: string, token?: string) => (
    <>
      <ManifestRosterFreshness
        tripId={tripId}
        renderId="scoped"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        historyScope={scope}
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel={label}
        copy={copy}
      />
      <ManifestRosterCommit
        tripId={tripId}
        renderId="scoped"
        renderToken={token}
        checkpoint="departure"
      />
    </>
  );
  const page = render(view("scope-a"));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view("scope-a", token));
  await waitFor(() => expect(screen.getByText(label)).toBeVisible());
  page.rerender(view("scope-b", token));
  expect(screen.queryByText(label)).toBeNull();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("removes the historical read time when the session is invalidated", async () => {
  const label = "last read before sign-out";
  const view = (token?: string) => (
    <>
      <ManifestRosterFreshness
        tripId={tripId}
        renderId="signed-out"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        historyScope="scope-a"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel={label}
        copy={copy}
      />
      <ManifestRosterCommit
        tripId={tripId}
        renderId="signed-out"
        renderToken={token}
        checkpoint="departure"
      />
    </>
  );
  const page = render(view());
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view(token));
  await waitFor(() => expect(screen.getByText(label)).toBeVisible());
  act(() => announceSessionInvalidation());
  expect(screen.queryByText(label)).toBeNull();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("does not restore a historical time after session invalidation while hidden", async () => {
  const label = "last read before hidden sign-out";
  const view = (mode: "visible" | "hidden", token?: string) => (
    <Activity mode={mode}>
      <ManifestRosterFreshness
        tripId={tripId}
        renderId="hidden"
        renderToken={token}
        renderProof={token ? "proof" : undefined}
        checkpoint="departure"
        requireCommit
        historyScope="scope-a"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel={label}
        copy={copy}
      />
      <ManifestRosterCommit
        tripId={tripId}
        renderId="hidden"
        renderToken={token}
        checkpoint="departure"
      />
    </Activity>
  );
  const page = render(view("visible"));
  await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  const token = readManifestHistoryCookie(document.cookie, tripId);
  page.rerender(view("visible", token));
  await waitFor(() => expect(screen.getByText(label)).toBeVisible());
  page.rerender(view("hidden", token));
  act(() => announceSessionInvalidation());
  page.rerender(view("visible", token));
  expect(screen.queryByText(label)).toBeNull();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
});

it("waits for the matching rendered roster to commit after live confirmation", async () => {
  const view = (token?: string, marker = false) => (
    <>
      <ManifestRosterFreshness
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
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
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
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
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
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
        historyScope="scope-one"
        readCompletedAt={1_794_581_040_000}
        readCompletedLabel="read completed"
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
