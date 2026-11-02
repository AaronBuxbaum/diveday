"use client";

import { useEffect, useState } from "react";
import { forgetThisReadyPage } from "@/lib/ready-offline";

/**
 * **The cancelled card forgets the phone's saved copy** (issue #2979). The
 * worker forgets it on a `?cancelled=` navigation, but a self-cancel's
 * redirect reaches a hydrated page without one, so the card asks the worker
 * itself, and drops the copy directly when no worker confirms. Silent on
 * success, apart from `data-ready-copy-forgotten`, set once the copy is gone
 * so a test can wait on the fact rather than on a clock.
 */
export function ForgetReadyCopy({ failedText }: { failedText: string }) {
  const [state, setState] = useState<"pending" | "forgotten" | "failed">("pending");
  useEffect(() => {
    void forgetThisReadyPage().then((ok) => setState(ok ? "forgotten" : "failed"));
  }, []);
  if (state === "forgotten") return <span hidden data-ready-copy-forgotten="" />;
  return state === "failed" ? (
    <p role="status" className="mx-auto max-w-prose px-4 text-center text-sm text-warning-strong">
      {failedText}
    </p>
  ) : null;
}
