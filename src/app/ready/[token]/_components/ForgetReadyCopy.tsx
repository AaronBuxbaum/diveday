"use client";

import { useEffect, useState } from "react";
import { forgetThisReadyPage } from "@/lib/ready-offline";

/**
 * **The cancelled card forgets the phone's saved copy** (issue #2979). The
 * worker forgets it on a `?cancelled=` navigation, but a self-cancel's
 * redirect reaches a hydrated page without one, so the card asks the worker
 * itself. Silent: a phone with no worker has no copy to forget.
 */
export function ForgetReadyCopy({ failedText }: { failedText: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void forgetThisReadyPage().then((ok) => setFailed(!ok));
  }, []);
  return failed ? (
    <p role="status" className="mx-auto max-w-prose px-4 text-center text-sm text-warning-strong">
      {failedText}
    </p>
  ) : null;
}
