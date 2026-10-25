"use client";

import { useEffect } from "react";
import { forgetThisReadyPage } from "@/lib/ready-offline";

/**
 * **The cancelled card forgets the phone's saved copy** (issue #2979). The
 * worker forgets it on a `?cancelled=` navigation, but a self-cancel's
 * redirect reaches a hydrated page without one, so the card asks the worker
 * itself. Silent: a phone with no worker has no copy to forget.
 */
export function ForgetReadyCopy() {
  useEffect(() => {
    void forgetThisReadyPage();
  }, []);
  return null;
}
