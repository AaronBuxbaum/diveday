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

/**
 * AmbientGlareDetector is a client-side component that listens to the device's
 * AmbientLightSensor. If the ambient light level is above the threshold, it
 * automatically activates "glare-mode" by adding the `.glare-mode` class to the
 * document root.
 *
 * It is automatic-only, with no manual toggle button required.
 */
export function AmbientGlareDetector() {
  const [, setGlareActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // A custom event listener to simulate ambient light changes in tests and dev environments
    const handleCustomLux = (e: Event) => {
      const detail = (e as CustomEvent<{ lux: number }>)?.detail;
      if (detail && typeof detail.lux === "number") {
        const isGlare = detail.lux >= GLARE_LUX_THRESHOLD;
        setGlareActive(isGlare);
        if (isGlare) {
          document.documentElement.classList.add("glare-mode");
        } else {
          document.documentElement.classList.remove("glare-mode");
        }
      }
    };
    window.addEventListener("diveday:set-lux", handleCustomLux);

    // Check if the experimental AmbientLightSensor API is supported
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
          const isGlare = lux >= GLARE_LUX_THRESHOLD;
          setGlareActive(isGlare);
          if (isGlare) {
            document.documentElement.classList.add("glare-mode");
          } else {
            document.documentElement.classList.remove("glare-mode");
          }
        }
      };

      const handleError = (event: Event) => {
        const errEvent = event as SensorErrorEvent;
        // Silently handle errors (e.g. permission denied)
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
            // Ignore errors on stop
          }
        }
        document.documentElement.classList.remove("glare-mode");
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
