"use client";

import { useEffect, useState } from "react";

export const GLARE_LUX_THRESHOLD = 10000; // 10,000 lux (outdoor bright sunlight)

interface LightSensor extends EventTarget {
  start(): void;
  stop(): void;
  illuminance?: number;
}

interface SensorErrorEvent extends Event {
  error?: Error;
}

export type ContrastMode = "auto" | "standard" | "full";
export const CONTRAST_MODE_STORAGE_KEY = "diveday:contrast-mode";
export const CONTRAST_MODE_CHANGE_EVENT = "diveday:contrast-mode-change";

/** Every word `AmbientContrastControl` renders, resolved server-side. */
export interface AmbientContrastCopy {
  modeLabel: string;
  labelAuto: string;
  labelLand: string;
  labelBoat: string;
}

/**
 * AmbientGlareDetector is a client-side component that listens to the device's
 * AmbientLightSensor. If the ambient light level is above the threshold, it
 * automatically activates "glare-mode" by adding the `.glare-mode` class to the
 * document root, unless overridden by the contrast tuning slider.
 */
export function AmbientGlareDetector() {
  const [mode, setMode] = useState<ContrastMode>("auto");
  const [sensorLux, setSensorLux] = useState(0);

  // Initialize mode from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedMode = localStorage.getItem(CONTRAST_MODE_STORAGE_KEY);
        if (savedMode === "standard" || savedMode === "full" || savedMode === "auto") {
          setMode(savedMode as ContrastMode);
        }
      } catch (err) {
        console.warn("Failed to read contrast mode from localStorage:", err);
      }
    }
  }, []);

  // Listen to contrast-mode changes from the slider
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleModeChange = (e: Event) => {
      const detail = (e as CustomEvent<{ mode: ContrastMode }>)?.detail;
      if (detail?.mode) {
        setMode(detail.mode);
      }
    };

    window.addEventListener(CONTRAST_MODE_CHANGE_EVENT, handleModeChange);
    return () => {
      window.removeEventListener(CONTRAST_MODE_CHANGE_EVENT, handleModeChange);
    };
  }, []);

  // Set the .glare-mode class dynamically
  useEffect(() => {
    let isGlare = false;
    if (mode === "full") {
      isGlare = true;
    } else if (mode === "standard") {
      isGlare = false;
    } else {
      isGlare = sensorLux >= GLARE_LUX_THRESHOLD;
    }

    if (isGlare) {
      document.documentElement.classList.add("glare-mode");
    } else {
      document.documentElement.classList.remove("glare-mode");
    }

    return () => {
      document.documentElement.classList.remove("glare-mode");
    };
  }, [mode, sensorLux]);

  // AmbientLightSensor readings drive auto mode, when the device has one.
  // Tests install a mock `window.AmbientLightSensor` constructor — there is
  // no separate test-only event pathway into this component.
  useEffect(() => {
    if (typeof window === "undefined" || !("AmbientLightSensor" in window)) return;

    let sensor: LightSensor | null = null;

    try {
      const AmbientLightSensorConstructor = (
        window as unknown as {
          AmbientLightSensor: new (options?: { frequency?: number }) => LightSensor;
        }
      ).AmbientLightSensor;
      sensor = new AmbientLightSensorConstructor({ frequency: 1 });

      const handleReading = () => {
        if (!sensor) return;
        const lux = sensor.illuminance;
        if (typeof lux === "number") {
          setSensorLux(lux);
        }
      };

      const handleError = (event: Event) => {
        const errEvent = event as SensorErrorEvent;
        console.warn("AmbientLightSensor error:", errEvent.error?.name, errEvent.error?.message);
      };

      sensor.addEventListener("reading", handleReading);
      sensor.addEventListener("error", handleError);
      sensor.start();

      return () => {
        if (sensor) {
          sensor.removeEventListener("reading", handleReading);
          sensor.removeEventListener("error", handleError);
          try {
            sensor.stop();
          } catch {
            // Ignore
          }
        }
      };
    } catch (err) {
      console.warn("Failed to initialize AmbientLightSensor:", err);
    }
  }, []);

  return null;
}

const CONTRAST_MODES = ["auto", "standard", "full"] as const;

/**
 * Manual override for the glare detection above — **"Boat mode"** to the crew
 * who use it: Auto follows the light sensor, Land mode pins it off, Boat mode
 * pins it on. It used to be labelled "Contrast: Auto / Standard / Maximum", and
 * sat under a separate "Glare mode active ☀" chip that said, less usefully,
 * what the control right beneath it already showed. One control, named after
 * the thing it is actually for.
 *
 * The internal vocabulary is still `standard`/`full` and the class it toggles
 * is still `.glare-mode` — the stored per-device value and the stylesheet, not
 * words anyone reads.
 *
 * A **segmented control**, not the range slider this used to be. Three named
 * stops is not a magnitude — nothing here is "more contrast than the last
 * notch" — and rendering it as a slider cost the surface three problems at
 * once: the three tick labels under a ~210px track ran into each other
 * ("AUTOSTANDARDMAXIMUM CONTRAST"), the mode had to be repeated in a chip
 * above the track because the handle position alone did not say which stop it
 * was on, and dragging a 1px rail is the wrong target for a wet hand on a
 * moving boat. Each option is now a real 44px button whose pressed state *is*
 * the answer, in the same segmented grammar as `QueueViewSwitch`.
 */
export function AmbientContrastControl({ copy }: { copy: AmbientContrastCopy }) {
  // The stored choice lives in this browser, so the server cannot know it. The
  // control renders in its Auto position — the default it is actually in until
  // told otherwise — and the effect below moves it only when this device has
  // stored something else.
  //
  // It used to gate the selected state on a `mounted` flag as well, which meant
  // the rendered markup showed *no* option selected until React hydrated: a
  // three-way segmented control with nothing chosen, on a page a crew opens on
  // a boat with a slow connection. It also made the control's painted state a
  // race — the visual suite caught it as one variant of four in which the Auto
  // pill was unfilled while the other three had it filled, which is the same
  // bug photographed rather than a different one. `mode` is "auto" on the
  // server and on the client's first render, so nothing here can mismatch on
  // hydration; only the stored value moves it, and that is a state change React
  // is happy to make after mount.
  const [mode, setMode] = useState<ContrastMode>("auto");

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const savedMode = localStorage.getItem(CONTRAST_MODE_STORAGE_KEY);
        if (savedMode === "standard" || savedMode === "full" || savedMode === "auto") {
          setMode(savedMode as ContrastMode);
        }
      } catch (err) {
        console.warn("Failed to read contrast mode from localStorage:", err);
      }
    }
  }, []);

  const choose = (next: ContrastMode) => {
    setMode(next);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(CONTRAST_MODE_STORAGE_KEY, next);
      } catch (err) {
        console.warn("Failed to write contrast mode to localStorage:", err);
      }
      window.dispatchEvent(new CustomEvent(CONTRAST_MODE_CHANGE_EVENT, { detail: { mode: next } }));
    }
  };

  const labelFor = (value: ContrastMode) =>
    value === "auto" ? copy.labelAuto : value === "standard" ? copy.labelLand : copy.labelBoat;

  return (
    // Real radios in a fieldset, not styled buttons: exactly one of the three
    // is on, arrow keys move between them for free, and the legend names the
    // group without a second visible heading.
    <fieldset className="select-none text-left print:hidden">
      <legend className="text-xs font-bold tracking-wide text-muted uppercase">
        {copy.modeLabel}
      </legend>
      <div className="mt-1.5 flex max-w-full overflow-x-auto overscroll-x-contain rounded-full border border-border bg-surface-sunken p-1">
        {CONTRAST_MODES.map((value) => {
          const active = value === mode;
          return (
            <label
              key={value}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              <input
                type="radio"
                name="contrast-mode"
                value={value}
                checked={active}
                onChange={() => choose(value)}
                className="sr-only"
              />
              {labelFor(value)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
