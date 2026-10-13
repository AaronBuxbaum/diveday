"use client";

import { useEffect, useState } from "react";
import { keepReadyPageOnDevice, READY_KEEP_UNTIL_META } from "@/lib/ready-offline";

/**
 * Keeps this page on the diver's phone for the marina with no signal, and
 * says so when that is what they are reading: offline, the page is the copy
 * the phone saved, and anything they change needs signal.
 *
 * It also dates the copy: `keepUntil` (`readyCopyKeepUntil`, the day after
 * the boat is due back) rides in a `<meta>` the worker reads when it saves the
 * page (security review of layer 8, D2). Only the live page renders this
 * component, so any other answer at the URL names no date and clears the copy.
 */
export function ReadyOfflineCopy({
  offlineNote,
  keepUntil,
}: {
  offlineNote: string;
  keepUntil: number;
}) {
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
  return (
    <>
      <meta name={READY_KEEP_UNTIL_META} content={String(keepUntil)} />
      {offline ? (
        <p role="status" className="mt-3 text-sm font-medium text-warning-strong">
          {offlineNote}
        </p>
      ) : null}
    </>
  );
}
