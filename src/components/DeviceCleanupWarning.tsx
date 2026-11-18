"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DEVICE_CLEANUP_WARNING_EVENT,
  deviceCleanupMayBeIncomplete,
} from "./device-cleanup-warning";
import { ErrorToast } from "./Toast";

/** A generic redirect flag never authorizes access or implies erasure. */
export function DeviceCleanupWarning({ message }: { message: string }) {
  const params = useSearchParams();
  const [storedWarning, setStoredWarning] = useState(false);
  useEffect(() => {
    const refresh = () => setStoredWarning((current) => current || deviceCleanupMayBeIncomplete());
    const warn = () => setStoredWarning(true);
    refresh();
    window.addEventListener(DEVICE_CLEANUP_WARNING_EVENT, warn);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener(DEVICE_CLEANUP_WARNING_EVENT, warn);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return params.get("device_cleanup") === "incomplete" || storedWarning ? (
    <ErrorToast message={message} durationMs={null} />
  ) : null;
}
