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

/** Every word `AmbientContrastSlider` renders, resolved server-side. */
export interface AmbientContrastCopy {
  contrastAutoFallback: string;
  contrastIconTitle: string;
  contrastLabel: string;
  labelAuto: string;
  labelStandard: string;
  labelFullAaa: string;
  modeAuto: string;
  modeStandard: string;
  modeFullAaa: string;
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

  // AmbientLightSensor and custom lux event listeners
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleCustomLux = (e: Event) => {
      const detail = (e as CustomEvent<{ lux: number }>)?.detail;
      if (detail && typeof detail.lux === "number") {
        setSensorLux(detail.lux);
      }
    };
    window.addEventListener("diveday:set-lux", handleCustomLux);

    if (!("AmbientLightSensor" in window)) {
      return () => {
        window.removeEventListener("diveday:set-lux", handleCustomLux);
      };
    }

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
        window.removeEventListener("diveday:set-lux", handleCustomLux);
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
      return () => {
        window.removeEventListener("diveday:set-lux", handleCustomLux);
      };
    }
  }, []);

  return null;
}

/**
 * AmbientContrastSlider is a slider UI that allows manual overrides of the contrast mode.
 * Toggling standard or full AAA contrast overrides the auto-glare detection.
 */
export function AmbientContrastSlider({ copy }: { copy: AmbientContrastCopy }) {
  const [mode, setMode] = useState<ContrastMode>("auto");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    const newMode: ContrastMode = val === 0 ? "auto" : val === 1 ? "standard" : "full";
    setMode(newMode);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(CONTRAST_MODE_STORAGE_KEY, newMode);
      } catch (err) {
        console.warn("Failed to write contrast mode to localStorage:", err);
      }
      window.dispatchEvent(
        new CustomEvent(CONTRAST_MODE_CHANGE_EVENT, { detail: { mode: newMode } }),
      );
    }
  };

  if (!mounted) {
    return (
      <div className="flex items-center h-11 px-3 border border-border rounded-xl bg-surface/50 opacity-50">
        <span className="text-xs font-semibold text-muted">{copy.contrastAutoFallback}</span>
      </div>
    );
  }

  const sliderVal = mode === "auto" ? 0 : mode === "standard" ? 1 : 2;
  const modeLabel =
    mode === "auto" ? copy.modeAuto : mode === "standard" ? copy.modeStandard : copy.modeFullAaa;

  return (
    <div
      data-testid="contrast-tuning-slider"
      className="flex flex-col gap-1.5 p-2.5 px-3 border border-border bg-surface rounded-xl shadow-sm min-w-[210px] select-none text-left print:hidden"
    >
      <div className="flex justify-between items-center text-xs font-bold text-muted uppercase">
        <span className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <title>{copy.contrastIconTitle}</title>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
          {copy.contrastLabel}
        </span>
        <span className="font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-foreground">
          {modeLabel}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="2"
        step="1"
        value={sliderVal}
        onChange={handleChange}
        aria-label={copy.contrastLabel}
        aria-valuetext={modeLabel}
        className="w-full h-1 bg-surface-sunken rounded-lg appearance-none cursor-pointer accent-primary"
      />
      <div className="flex justify-between text-xs text-muted font-bold px-0.5 uppercase tracking-wider">
        <span>{copy.labelAuto}</span>
        <span>{copy.labelStandard}</span>
        <span>{copy.labelFullAaa}</span>
      </div>
    </div>
  );
}
