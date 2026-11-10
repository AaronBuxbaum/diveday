"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import {
  HOME_SCREEN_INSTALL_DISMISSED_KEY,
  homeScreenInstallPreference,
  type InstallPlatform,
  installPlatform,
} from "@/features/home-screen-install";

export type HomeScreenInstallCopy = {
  body: string;
  install: string;
  dismiss: string;
  safari: string;
  otherIos: string;
  chrome: string;
  promptFailed: string;
};

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * One quiet row after the Logbook's work (ADR 20260907-in-your-hands, slice 19e).
 * Native installation is offered only for an actual deferred browser event, never UA inference.
 * Installation says nothing about connectivity, saved manifests or notification permission.
 */
export function HomeScreenInstall({ copy }: { copy: HomeScreenInstallCopy }) {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const displayModes = ["standalone", "fullscreen", "minimal-ui"].map((mode) =>
      window.matchMedia(`(display-mode: ${mode})`),
    );
    const readPlatform = () => {
      try {
        if (
          window.self !== window.top ||
          (navigator as Navigator & { standalone?: boolean }).standalone ||
          displayModes.some((mode) => mode.matches) ||
          homeScreenInstallPreference.dismissed(() => localStorage)
        ) {
          setPlatform(null);
          setPrompt(null);
          return;
        }
        setPlatform(installPlatform(navigator));
      } catch {
        setPlatform(null);
      }
    };
    const beforeInstall = (event: Event) => {
      // iOS uses Safari's Share menu. Never promise a native sheet there, even for a stray event.
      const device = installPlatform(navigator);
      if (!device?.startsWith("android") || typeof (event as InstallPrompt).prompt !== "function")
        return;
      readPlatform();
      if (
        window.self !== window.top ||
        displayModes.some((mode) => mode.matches) ||
        homeScreenInstallPreference.dismissed(() => localStorage)
      )
        return;
      event.preventDefault();
      setPrompt(event as InstallPrompt);
      setFailed(false);
    };
    const installed = () => {
      homeScreenInstallPreference.dismiss(() => localStorage);
      setPlatform(null);
      setPrompt(null);
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === HOME_SCREEN_INSTALL_DISMISSED_KEY || event.key === null) readPlatform();
    };
    readPlatform();
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("storage", storageChanged);
    for (const mode of displayModes) mode.addEventListener("change", readPlatform);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("storage", storageChanged);
      for (const mode of displayModes) mode.removeEventListener("change", readPlatform);
    };
  }, []);

  function dismiss() {
    homeScreenInstallPreference.dismiss(() => localStorage);
    setPlatform(null);
    setPrompt(null);
  }

  async function install() {
    if (!prompt || inFlight.current) return;
    const availablePrompt = prompt;
    inFlight.current = true;
    setBusy(true);
    // A deferred event is single-use, even when its sheet is refused or fails.
    setPrompt(null);
    try {
      await availablePrompt.prompt();
      await availablePrompt.userChoice;
      dismiss();
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!platform || (platform === "android-other" && !prompt && !busy)) return null;
  const instruction =
    platform === "ios-safari"
      ? copy.safari
      : platform === "ios-other"
        ? copy.otherIos
        : copy.chrome;
  return (
    <aside
      data-home-screen-install
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted print:hidden"
    >
      <p className="min-w-0 flex-1 basis-64">
        {copy.body}{" "}
        {!prompt && !busy ? (
          <>
            {platform.startsWith("ios") ? <ShareGlyph /> : null}
            {instruction}
          </>
        ) : null}
        {failed ? <span role="status"> {copy.promptFailed}</span> : null}
      </p>
      {prompt || busy ? (
        <button
          type="button"
          disabled={busy}
          className={buttonClass({ variant: "secondary", size: "sm" })}
          onClick={install}
        >
          {copy.install}
        </button>
      ) : null}
      <button
        type="button"
        className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
        onClick={dismiss}
      >
        {copy.dismiss}
      </button>
    </aside>
  );
}

function ShareGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="me-1 inline size-4 align-text-bottom"
    >
      <path d="M8 5l4-4 4 4M12 1v14M5 10H3v12h18V10h-2" />
    </svg>
  );
}
