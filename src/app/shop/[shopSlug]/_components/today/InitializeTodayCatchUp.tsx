"use client";

import { useEffect } from "react";

/** The first view establishes a baseline without mutating during server render. */
export function InitializeTodayCatchUp({ action }: { action: () => Promise<void> }) {
  useEffect(() => {
    void action();
  }, [action]);
  return null;
}
