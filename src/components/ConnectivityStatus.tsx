"use client";

import { useEffect, useState } from "react";

export function ConnectivityStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
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
      {online ? "Connection available" : "No signal · device copy"}
    </span>
  );
}
