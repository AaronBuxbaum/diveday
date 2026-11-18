"use client";

import { useEffect, useState } from "react";
import { deviceCleanupMayBeIncomplete } from "./device-cleanup-status";

/** The URL flag is only a warning, never proof of identity or erasure. */
export function DeviceCleanupWarning({ message }: { message: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const flagged =
      new URLSearchParams(window.location.search).get("deviceCleanup") === "incomplete";
    setVisible(flagged || deviceCleanupMayBeIncomplete());
  }, []);
  return visible ? <p role="alert">{message}</p> : null;
}
