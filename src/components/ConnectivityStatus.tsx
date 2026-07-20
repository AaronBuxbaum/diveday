"use client";

import { useEffect, useState } from "react";

export function ConnectivityStatus({
  offlineLabel = "No signal · device copy",
}: {
  /** What "offline" means on this surface (the manifest has a device copy; a
   * live-only surface like check-in warns its board may be stale instead). */
  offlineLabel?: string;
} = {}) {
  // Start "online" so the server render and the first client render agree — a
  // navigator.onLine read in the initializer differs across the boundary and
  // trips a hydration mismatch on any server-rendered surface. The effect
  // reconciles to the real state immediately after mount.
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

  return (
    <span
      role="status"
      aria-live="polite"
      title={online ? "This browser reports a connection." : "This browser reports no connection."}
      className={
        online
          ? "inline-flex min-h-9 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-sm font-bold text-success"
          : "inline-flex min-h-9 items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm font-bold text-warning"
      }
    >
      <span aria-hidden="true" className="text-base leading-none">
        {online ? "●" : "×"}
      </span>
      {online ? "Connection available" : offlineLabel}
    </span>
  );
}
