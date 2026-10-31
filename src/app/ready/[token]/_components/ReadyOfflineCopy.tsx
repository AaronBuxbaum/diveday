"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { forgetReadyPageCopy, keepReadyPageOnDevice } from "@/lib/ready-offline";

/**
 * Keeps this page's snapshot on the diver's phone for the marina with no
 * signal (`src/worker/ready-page-cache.ts`), and says so once it is kept. What
 * the phone shows offline is not this page but a read-only snapshot of where to
 * go and when, built by the server (`/ready/<token>/offline`) and dated in its
 * own banner; this component draws nothing into it.
 *
 * **The copy is kept on any browser that opens the link** (issue #2693), a
 * hotel PC or a shop tablet as well as the diver's phone, so once one is kept
 * the page says so and offers "Remove saved copy" (`forgetReadyPageCopy`).
 * **Never offline** (domain review 2, blocking): a page still open when the
 * signal drops would delete the diver's only copy, with no way to keep it
 * again, on one wet tap. Removal is for a device you are on with signal, and
 * the snapshot itself has no such button.
 */
export function ReadyOfflineCopy({
  copy,
}: {
  copy: { savedNote: string; remove: string; removed: string; removeFailed: string };
}) {
  const [offline, setOffline] = useState(false);
  const [saved, setSaved] = useState<"no" | "kept" | "removed" | "removeFailed">("no");
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
      // A page already open when the signal went: its copy is the one kept.
      setSaved("kept");
    }
    return () => {
      live = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const remove = async () => {
    setSaved((await forgetReadyPageCopy()) ? "removed" : "removeFailed");
  };
  return saved === "kept" && !offline ? (
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
  ) : saved === "removeFailed" ? (
    <p role="status" className="mt-2 text-sm text-warning-strong">
      {copy.removeFailed}
    </p>
  ) : null;
}
