"use client";

import { useEffect, useState } from "react";
import { keepReadyPageOnDevice } from "@/lib/ready-offline";

/**
 * Keeps this page on the diver's phone for the marina with no signal, and
 * says so when that is what they are reading: offline, the page is the copy
 * the phone saved, and anything they change needs signal.
 */
export function ReadyOfflineCopy({ offlineNote }: { offlineNote: string }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if (navigator.onLine) void keepReadyPageOnDevice();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <p role="status" className="mt-3 text-sm font-medium text-warning-strong">
      {offlineNote}
    </p>
  );
}
