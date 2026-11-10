// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buttonClass } from "@/components/ui/button";
import {
  HOME_SCREEN_INSTALL_DISMISSED_KEY,
  homeScreenInstallPreference,
} from "@/features/home-screen-install";
import { staffTranslator } from "@/i18n/staff-messages";
import { rendersFlush } from "@/test/button-flush";
import { HomeScreenInstall, type HomeScreenInstallCopy } from "./HomeScreenInstall";

const t = staffTranslator("en-US");
const copy: HomeScreenInstallCopy = {
  body: t("shopHome.install.body"),
  install: t("shopHome.install.action"),
  dismiss: t("shopHome.install.dismiss"),
  safari: t("shopHome.install.safari"),
  otherIos: t("shopHome.install.otherIos"),
  chrome: t("shopHome.install.chrome"),
  promptFailed: t("shopHome.install.promptFailed"),
};
const ANDROID = "Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1";
let media: MediaQueryList[];
let readDismissed: ReturnType<typeof vi.spyOn>;

function device(userAgent: string, maxTouchPoints = 5) {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: maxTouchPoints });
}
function offer(outcome: "accepted" | "dismissed" = "accepted", error = false) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(async () => {
    if (error) throw new Error("unavailable");
  });
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  act(() => window.dispatchEvent(event));
  return { event, prompt };
}

beforeEach(() => {
  device(ANDROID);
  Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
  media = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const target = new EventTarget();
      const item = Object.assign(target, {
        matches: false,
        media: query,
      }) as unknown as MediaQueryList;
      media.push(item);
      return item;
    }),
  );
  readDismissed = vi.spyOn(homeScreenInstallPreference, "dismissed").mockReturnValue(false);
  vi.spyOn(homeScreenInstallPreference, "dismiss").mockImplementation(() => {
    readDismissed.mockReturnValue(true);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HomeScreenInstall", () => {
  it("offers Chrome instructions until a real event arrives, never an invented native prompt", () => {
    render(<HomeScreenInstall copy={copy} />);
    expect(screen.getByText(copy.chrome, { exact: false })).toBeVisible();
    expect(screen.queryByRole("button", { name: copy.install })).not.toBeInTheDocument();
    const { event, prompt } = offer();
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: copy.install })).toHaveAttribute(
      "class",
      buttonClass({ variant: "secondary", size: "sm" }),
    );
    expect(rendersFlush(screen.getByRole("button", { name: copy.dismiss }), "ghost", "sm")).toBe(
      true,
    );
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each(["accepted", "dismissed"] as const)(
    "calls the single-use native prompt only on a tap and retires it when %s",
    async (outcome) => {
      render(<HomeScreenInstall copy={copy} />);
      const { prompt } = offer(outcome);
      const button = screen.getByRole("button", { name: copy.install });
      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(homeScreenInstallPreference.dismiss).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
      offer();
      expect(screen.queryByRole("button", { name: copy.install })).not.toBeInTheDocument();
    },
  );

  it("falls back to menu instructions after a failed native prompt without retrying a used event", async () => {
    render(<HomeScreenInstall copy={copy} />);
    const { prompt } = offer("accepted", true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: copy.install })));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(copy.promptFailed);
    expect(screen.getByText(copy.chrome, { exact: false })).toBeVisible();
    expect(screen.queryByRole("button", { name: copy.install })).not.toBeInTheDocument();
  });

  it.each([
    [IPHONE, copy.safari],
    [IPHONE.replace("Version/18.0", "CriOS/140.0"), copy.otherIos],
  ])("gives accurate iOS instructions, never a native button (%s)", (ua, instruction) => {
    device(ua);
    render(<HomeScreenInstall copy={copy} />);
    expect(screen.getByText(instruction, { exact: false })).toBeVisible();
    offer();
    expect(screen.queryByRole("button", { name: copy.install })).not.toBeInTheDocument();
  });

  it("supports the desktop user agent of a touch iPad", () => {
    device("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15");
    render(<HomeScreenInstall copy={copy} />);
    expect(screen.getByText(copy.safari, { exact: false })).toBeVisible();
  });

  it("renders nothing for other Android browsers without a real install event", () => {
    device(ANDROID.replace("Chrome/", "SamsungBrowser/28 Chrome/"));
    render(<HomeScreenInstall copy={copy} />);
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
    offer();
    expect(screen.getByRole("button", { name: copy.install })).toBeVisible();
  });

  it.each([
    "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15",
  ])("renders nothing on desktop, even if a prompt event fires (%s)", (ua) => {
    device(ua, 0);
    render(<HomeScreenInstall copy={copy} />);
    offer();
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
  });

  it.each(["standalone", "fullscreen", "minimal-ui"])(
    "renders nothing in %s display mode",
    (mode) => {
      vi.stubGlobal("matchMedia", (query: string) =>
        Object.assign(new EventTarget(), { matches: query.includes(mode), media: query }),
      );
      render(<HomeScreenInstall copy={copy} />);
      offer();
      expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
    },
  );

  it("renders nothing for the iOS standalone signal", () => {
    device(IPHONE);
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    render(<HomeScreenInstall copy={copy} />);
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
  });

  it("renders nothing in an embed", () => {
    vi.spyOn(window, "self", "get").mockReturnValue({} as Window & typeof globalThis);
    render(<HomeScreenInstall copy={copy} />);
    offer();
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
  });

  it("keeps dismissal through remounts and ignores later install events", () => {
    const first = render(<HomeScreenInstall copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: copy.dismiss }));
    first.unmount();
    render(<HomeScreenInstall copy={copy} />);
    offer();
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
  });

  it("suppresses on a refused preference read", () => {
    readDismissed.mockReturnValue(true);
    render(<HomeScreenInstall copy={copy} />);
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
  });

  it("responds to installation and another tab's dismissal", () => {
    const first = render(<HomeScreenInstall copy={copy} />);
    act(() => window.dispatchEvent(new Event("appinstalled")));
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
    first.unmount();
    readDismissed.mockReturnValue(false);
    render(<HomeScreenInstall copy={copy} />);
    expect(screen.getByText(copy.body, { exact: false })).toBeVisible();
    readDismissed.mockReturnValue(true);
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: HOME_SCREEN_INSTALL_DISMISSED_KEY, newValue: "yes" }),
      ),
    );
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
  });

  it("hides if the display mode changes to installed", () => {
    render(<HomeScreenInstall copy={copy} />);
    Object.defineProperty(media[0], "matches", { value: true });
    act(() => media[0].dispatchEvent(new Event("change")));
    expect(screen.queryByText(copy.body, { exact: false })).not.toBeInTheDocument();
  });
});
