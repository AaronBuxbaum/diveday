"use client";

import { useEffect, useRef, useState } from "react";

/** The first view establishes a baseline without mutating during server render. */
export function InitializeTodayCatchUp({ action }: { action: () => Promise<void> }) {
  type State = "pending" | "ready" | "failed";
  const actionRun = useRef<{
    action: () => Promise<void>;
    promise: Promise<void>;
  } | null>(null);
  const [status, setStatus] = useState<{ action: () => Promise<void>; state: State }>(() => ({
    action,
    state: "pending",
  }));
  // Render a new action identity as pending immediately, before its effect runs.
  const state = status.action === action ? status.state : "pending";

  useEffect(() => {
    let mounted = true;
    let run = actionRun.current;
    if (!run || run.action !== action) {
      setStatus({ action, state: "pending" });
      let promise: Promise<void>;
      try {
        promise = Promise.resolve(action());
      } catch (error) {
        promise = Promise.reject(error);
      }
      run = { action, promise };
      actionRun.current = run;
    }
    const currentRun = run;
    void currentRun.promise.then(
      () => {
        if (mounted && actionRun.current === currentRun) {
          setStatus({ action: currentRun.action, state: "ready" });
        }
      },
      (error: unknown) => {
        console.error("Failed to initialize Today catch-up baseline", error);
        if (mounted && actionRun.current === currentRun) {
          setStatus({ action: currentRun.action, state: "failed" });
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, [action]);

  return <span hidden aria-hidden="true" data-today-catch-up-state={state} />;
}
