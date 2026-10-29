"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import {
  forgetReadyPageCopy,
  keepReadyPageOnDevice,
  READY_COPY_GENERATED_AT_META,
  READY_COPY_LOCALE_META,
  READY_COPY_TIME_ZONE_META,
  READY_COPY_VERSION,
  READY_COPY_VERSION_META,
  READY_KEEP_UNTIL_META,
  READY_OFFLINE_NOTE_ATTR,
} from "@/lib/ready-offline";

/**
 * Keeps this page on the diver's phone for the marina with no signal, and
 * says so when that is what they are reading: offline, the page is the copy
 * the phone saved from a server-generated page, and changes need signal.
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
  locale,
  timeZone,
  generatedAt,
}: {
  copy: {
    offlineNote: string;
    savedNote: string;
    remove: string;
    removed: string;
    removeFailed: string;
    clockRollbackHeading: string;
    clockRollbackSaved: string;
    clockRollbackUnknown: string;
    clockUnverified: string;
  };
  keepUntil: number;
  locale: string;
  timeZone: string;
  generatedAt: number;
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
    setSaved((await forgetReadyPageCopy()) ? "removed" : "removeFailed");
  };
  return (
    <>
      <meta name={READY_KEEP_UNTIL_META} content={String(keepUntil)} />
      <meta name={READY_COPY_LOCALE_META} content={locale} />
      <meta name={READY_COPY_TIME_ZONE_META} content={timeZone} />
      <meta name={READY_COPY_GENERATED_AT_META} content={String(generatedAt)} />
      <meta name={READY_COPY_VERSION_META} content={READY_COPY_VERSION} />
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
      <section data-ready-clock-rollback="" hidden className="mx-auto max-w-xl px-6 py-12">
        <h1 className={SHELL_TITLE_CLASS}>{copy.clockRollbackHeading}</h1>
        <p data-ready-clock-rollback-saved="" hidden className="mt-3 text-base text-muted">
          {copy.clockRollbackSaved}
        </p>
        <p data-ready-clock-rollback-unknown="" hidden className="mt-3 text-base text-muted">
          {copy.clockRollbackUnknown}
        </p>
      </section>
      <section data-ready-clock-unverified="" hidden className="mx-auto max-w-xl px-6 py-12">
        <p data-ready-clock-unverified-copy="" hidden className="text-base text-muted">
          {copy.clockUnverified}
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
      ) : saved === "removeFailed" ? (
        <p role="status" className="mt-2 text-sm text-warning-strong">
          {copy.removeFailed}
        </p>
      ) : null}
    </>
  );
}
