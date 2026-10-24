"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import {
  forgetReadyPageCopy,
  keepReadyPageOnDevice,
  READY_KEEP_UNTIL_META,
} from "@/lib/ready-offline";

/**
 * Keeps this page on the diver's phone for the marina with no signal, and
 * says so when that is what they are reading: offline, the page is the copy
 * the phone saved, and anything they change needs signal.
 *
 * It also dates the copy: `keepUntil` (`readyCopyKeepUntil`, the day after
 * the boat is due back) rides in a `<meta>` the worker reads when it saves the
 * page (security review of layer 8, D2). Only the live page renders this
 * component, so any other answer at the URL names no date and clears the copy.
 *
 * **The copy is kept on any browser that opens the link** (issue #2693), a
 * hotel PC or a shop tablet as well as the diver's phone, so once one is kept
 * the page says so and offers "Remove saved copy" (`forgetReadyPageCopy`).
 * **Never offline** (domain review 2, blocking): there the copy on screen is
 * the diver's only one, at a dock with no way to keep it again, so one wet tap
 * must not delete it. Removal is for a device you are on with signal.
 */
export function ReadyOfflineCopy({
  copy,
  keepUntil,
}: {
  copy: { offlineNote: string; savedNote: string; remove: string; removed: string };
  keepUntil: number;
}) {
  const [offline, setOffline] = useState(false);
  const [saved, setSaved] = useState<"no" | "kept" | "removed">("no");
  useEffect(() => {
    let live = true;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if (navigator.onLine) {
      void keepReadyPageOnDevice().then((kept) => {
        if (live && kept) setSaved((now) => (now === "no" ? "kept" : now));
      });
    } else {
      // Offline, what is on screen is the kept copy.
      setSaved("kept");
    }
    return () => {
      live = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const remove = async () => {
    await forgetReadyPageCopy();
    setSaved("removed");
  };
  return (
    <>
      <meta name={READY_KEEP_UNTIL_META} content={String(keepUntil)} />
      {offline ? (
        <p role="status" className="mt-3 text-sm font-medium text-warning-strong">
          {copy.offlineNote}
        </p>
      ) : null}
      {/* Offline, the note above already says this is the saved copy. */}
      {saved === "kept" && !offline ? (
        <p className="mt-2 text-sm text-muted">
          {`${copy.savedNote} `}
          <button
            type="button"
            onClick={remove}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {copy.remove}
          </button>
        </p>
      ) : saved === "removed" ? (
        <p role="status" className="mt-2 text-sm text-muted">
          {copy.removed}
        </p>
      ) : null}
    </>
  );
}
