"use client";

import { useEffect, useState } from "react";
import { deviceCleanupMayBeIncomplete, forgetThisDevice } from "./forget-device";

/** Mounted on sign-in to attempt local cleanup without delaying sign-out. */
export function ForgetThisDevice({ incompleteMessage }: { incompleteMessage?: string }) {
  const [incomplete, setIncomplete] = useState(false);
  useEffect(() => {
    let active = true;
    if (deviceCleanupMayBeIncomplete()) setIncomplete(true);
    void forgetThisDevice().then(
      (result) => {
        if (active && result.status === "incomplete") setIncomplete(true);
      },
      () => {
        if (active) setIncomplete(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return incomplete && incompleteMessage ? <p role="alert">{incompleteMessage}</p> : null;
}
