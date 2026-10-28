// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetReadyPageCopy,
  keepReadyPageOnDevice,
  READY_COPY_GENERATED_AT_ATTR,
  READY_COPY_LOCALE_META,
  READY_COPY_TIME_ZONE_META,
  READY_COPY_VERSION,
  READY_COPY_VERSION_META,
  READY_OFFLINE_GENERATED_AT_PLACEHOLDER,
} from "@/lib/ready-offline";
import { readyPageFallback, saveReadyPage } from "@/worker/ready-page-cache";
import { ReadyOfflineCopy } from "./ReadyOfflineCopy";

vi.mock("@/lib/ready-offline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ready-offline")>()),
  keepReadyPageOnDevice: vi.fn(async () => true),
  forgetReadyPageCopy: vi.fn(async () => true),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(keepReadyPageOnDevice).mockClear();
  vi.mocked(forgetReadyPageCopy).mockClear();
});

const NOTE = `No signal: this is a copy of the page generated ${READY_OFFLINE_GENERATED_AT_PLACEHOLDER}.`;
const COPY = {
  offlineNote: NOTE,
  savedNote: "Saved on this device for when there’s no signal.",
  remove: "Remove saved copy",
  removed: "Removed from this device until you next open this link.",
  removeFailed: "Could not remove the saved copy. Free up storage and try again online.",
};
const KEEP_UNTIL = 1_800_000_000_000;
const LOCALE = "en-US";
const TIME_ZONE = "America/New_York";

describe("ReadyOfflineCopy", () => {
  it("online, says nothing and keeps the page on the phone", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    // Drawn, for the kept copy to show (issue #3003), but hidden online.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(NOTE)).not.toBeVisible();
    expect(keepReadyPageOnDevice).toHaveBeenCalledTimes(1);
  });

  it("offline, says it is the saved copy and asks the worker for nothing", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
    expect(keepReadyPageOnDevice).not.toHaveBeenCalled();
  });

  it("follows the connection as it drops", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(NOTE);
  });

  /** Security review of layer 8, D2: the worker keeps the copy only until the date the page names. */
  it("dates the copy for the worker that keeps it", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    expect(document.querySelector('meta[name="diveday-ready-keep-until"]')).toHaveAttribute(
      "content",
      String(KEEP_UNTIL),
    );
  });

  /**
   * **The diver can take the copy off this device** (issue #2693): the page
   * is kept silently on any browser that opens the link, a hotel PC or a shop
   * tablet among them. The control shows only once a copy is actually kept.
   */
  it("offers to remove the copy once one is kept, and says when it is gone", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    const remove = await screen.findByRole("button", { name: COPY.remove });
    expect(screen.getByText(COPY.savedNote)).toBeTruthy();

    await act(async () => {
      fireEvent.click(remove);
    });
    expect(forgetReadyPageCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(COPY.removed);
  });

  it("offers nothing to remove when nothing was kept", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.mocked(keepReadyPageOnDevice).mockResolvedValueOnce(false);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    await act(async () => {});
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
  });

  it("does not say the copy was removed when storage cleanup fails", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.mocked(forgetReadyPageCopy).mockResolvedValueOnce(false);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    const remove = await screen.findByRole("button", { name: COPY.remove });
    await act(async () => {
      fireEvent.click(remove);
    });
    expect(screen.getByRole("status")).toHaveTextContent(COPY.removeFailed);
    expect(screen.queryByText(COPY.removed)).toBeNull();
  });

  /**
   * **Offline, the copy cannot be removed** (domain review 2, blocking): at a
   * dock with no signal it is the diver's only copy, and nothing can keep it
   * again, so a wet-hand tap must not delete it.
   */
  it("offline, offers no way to remove the copy on screen", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
    // Said once: the offline note already says this is the saved copy.
    expect(screen.queryByText(COPY.savedNote, { exact: false })).toBeNull();
  });

  it("takes the remove control away when the signal drops, and gives it back with signal", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    await screen.findByRole("button", { name: COPY.remove });
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.queryByRole("button", { name: COPY.remove })).toBeNull();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("button", { name: COPY.remove })).toBeTruthy();
  });

  /**
   * The phone's kept copy runs no script (issue #3003), so this component
   * cannot show its own "No signal" line there. The server draws the line
   * hidden, and the worker shows it in the copy it keeps. Rendered by the real
   * component into the real worker, so the two cannot drift apart.
   */
  it("draws the no-signal line hidden for the server, and the kept copy shows it", async () => {
    const token = "A".repeat(43);
    const now = KEEP_UNTIL - 1_000_000;
    const markup = renderToStaticMarkup(
      <ReadyOfflineCopy
        copy={COPY}
        keepUntil={KEEP_UNTIL}
        locale={LOCALE}
        timeZone={TIME_ZONE}
        generatedAt={KEEP_UNTIL}
      />,
    );
    expect(markup).toMatch(/<p [^>]*hidden=""[^>]*>No signal/);

    const entries = new Map<string, Response>();
    const cache = {
      keys: async () => [...entries.keys()].map((key) => new Request(`https://dive.day${key}`)),
      delete: async (key: string) => entries.delete(key),
      put: async (key: string, response: Response) => {
        entries.set(key, response);
      },
      match: async (key: string) => entries.get(key)?.clone(),
    };
    const storage = { open: async () => cache } as unknown as CacheStorage;
    const page = new Response(markup, { headers: { "content-type": "text/html" } });
    expect(await saveReadyPage(storage, `/ready/${token}`, page, now)).toBe(true);

    const served = (await (await readyPageFallback(storage, `/ready/${token}`, now))?.text()) ?? "";
    const expected = new Intl.DateTimeFormat(LOCALE, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: TIME_ZONE,
    }).format(new Date(KEEP_UNTIL));
    expect(served.replaceAll("\u00a0", " ")).toContain(
      `No signal: this is a copy of the page generated ${expected}.`,
    );
    expect(served).not.toContain(READY_OFFLINE_GENERATED_AT_PLACEHOLDER);
    expect(served).toContain(`name="${READY_COPY_LOCALE_META}" content="${LOCALE}"`);
    expect(served).toContain(`name="${READY_COPY_TIME_ZONE_META}" content="${TIME_ZONE}"`);
    expect(served).toContain(`name="${READY_COPY_VERSION_META}" content="${READY_COPY_VERSION}"`);
    expect(served).toContain(`${READY_COPY_GENERATED_AT_ATTR}="${KEEP_UNTIL}"`);
    expect(served).not.toMatch(/<p [^>]*hidden=""[^>]*>No signal/);
  });
});
