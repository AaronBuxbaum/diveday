"use client";

import { useEffect, useState } from "react";
import {
  DEVICE_CLEANUP_WARNING_EVENT,
  deviceCleanupMayBeIncomplete,
  markDeviceCleanupIncomplete,
} from "./device-cleanup-warning";
import { forgetThisDevice } from "./forget-device";
import { ErrorToast } from "./Toast";

/** Attempt cleanup after a session ends; report an incomplete result. */
export function ForgetThisDevice({ warning }: { warning: string }) {
  const [incomplete, setIncomplete] = useState(false);
  useEffect(() => {
    let active = true;
    const warn = () => setIncomplete(true);
    window.addEventListener(DEVICE_CLEANUP_WARNING_EVENT, warn);
    if (deviceCleanupMayBeIncomplete()) setIncomplete(true);
    void forgetThisDevice().then(
      (result) => {
        if (active && !result.offlineSensitiveCleanupReportedComplete) setIncomplete(true);
      },
      () => {
        markDeviceCleanupIncomplete();
        if (active) setIncomplete(true);
      },
    );
    return () => {
      active = false;
      window.removeEventListener(DEVICE_CLEANUP_WARNING_EVENT, warn);
    };
  }, []);
  return incomplete ? <ErrorToast message={warning} durationMs={null} /> : null;
}
