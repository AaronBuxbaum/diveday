"use client";

import { useEffect, useState } from "react";

/**
 * `navigator.onLine`, kept current. Starts `true` so the first client render
 * matches `ConnectivityStatus`'s, and reconciles after mount.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}
