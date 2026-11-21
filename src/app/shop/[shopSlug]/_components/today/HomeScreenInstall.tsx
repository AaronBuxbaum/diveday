"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import {
  HOME_SCREEN_INSTALL_DISMISSED_KEY,
  homeScreenInstallPreference,
  type InstallPlatform,
  installPlatform,
} from "@/features/platform/home-screen-install";

export type HomeScreenInstallCopy = {
  body: string;
  install: string;
  dismiss: string;
  stepsLabel: string;
  openSafari: string;
  share: string;
  scroll: string;
  add: string;
  chromeMenu: string;
  chromeAdd: string;
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
  const [showSteps, setShowSteps] = useState(false);
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
      setShowSteps(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!platform || (platform === "android-other" && !prompt && !busy)) return null;
  const ios = platform.startsWith("ios");
  const steps = ios
    ? [...(platform === "ios-other" ? [copy.openSafari] : []), copy.share, copy.scroll, copy.add]
    : [copy.chromeMenu, copy.chromeAdd];
  const stepsOpen = !prompt && showSteps;
  return (
    <aside data-home-screen-install className="space-y-2 text-sm text-muted print:hidden">
      <p>{copy.body}</p>
      {failed ? <p role="status">{copy.promptFailed}</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          disabled={busy}
          aria-expanded={prompt ? undefined : stepsOpen}
          className={buttonClass({ variant: "secondary", size: "sm" })}
          onClick={prompt || busy ? install : () => setShowSteps((open) => !open)}
        >
          {copy.install}
        </button>
        <button
          type="button"
          className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
          onClick={dismiss}
        >
          {copy.dismiss}
        </button>
      </div>
      {stepsOpen ? (
        <ul aria-label={copy.stepsLabel} className="list-disc space-y-1 ps-5">
          {steps.map((step) => (
            <li key={step}>
              {step === copy.share ? <ShareGlyph /> : null}
              {step}
            </li>
          ))}
        </ul>
      ) : null}
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
