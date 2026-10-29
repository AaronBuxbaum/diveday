"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import {
  forgetReadyPageCopy,
  keepReadyPageOnDevice,
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_NOTE_ATTR,
  READY_SERVER_SAVED_AT_META,
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
  serverSavedAt = 0,
}: {
  copy: {
    offlineNote: string;
    savedNote: string;
    remove: string;
    removed: string;
    clockSaved: string;
    clockUnknown: string;
    clockRollbackHeading: string;
    clockRollbackSaved: string;
    clockRollbackUnknown: string;
  };
  keepUntil: number;
  serverSavedAt?: number;
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
      <meta name={READY_SERVER_SAVED_AT_META} content={String(serverSavedAt)} />
      {/* Drawn by the server too, hidden: the kept copy runs no script, and
        the worker shows this line in it (issue #3003). The marker comes first
        and `hidden` straight after it, the order the worker reads. */}
      <p
        {...{ [READY_OFFLINE_NOTE_ATTR]: "" }}
        hidden={!offline}
        role="status"
        className="mt-3 text-sm font-medium text-warning-strong"
      >
        {copy.offlineNote}
      </p>
      {/* The worker reveals one of these static notes in the script-free copy. */}
      <p data-ready-clock-saved-note="" hidden className="mt-2 text-sm text-muted">
        {copy.clockSaved}
      </p>
      <p data-ready-clock-unknown-note="" hidden className="mt-2 text-sm text-warning-strong">
        {copy.clockUnknown}
      </p>
      {/* A detected rollback replaces the page with this script-free warning screen. */}
      <section data-ready-clock-rollback="" hidden className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-2xl font-semibold">{copy.clockRollbackHeading}</h1>
        <p data-ready-clock-rollback-saved="" hidden className="mt-3 text-base text-muted">
          {copy.clockRollbackSaved}
        </p>
        <p data-ready-clock-rollback-unknown="" hidden className="mt-3 text-base text-muted">
          {copy.clockRollbackUnknown}
        </p>
      </section>
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
