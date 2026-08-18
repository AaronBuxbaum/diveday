"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { MINUTE_MS } from "@/lib/clock";

function remainingLabel(remainingMs: number, lessThanMinute: string): string {
  const minutes = Math.ceil(Math.max(0, remainingMs) / MINUTE_MS);
  if (minutes === 0) return lessThanMinute;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

export type RecapSendControlCopy = {
  waiting: string;
  due: string;
  paused: string;
  failed: string;
  noScheduledReturn: string;
  send: string;
  sending: string;
  pause: string;
  pausing: string;
  unpause: string;
  unpausing: string;
  lessThanMinute: string;
};

export function RecapSendControl({
  sendAction,
  togglePauseAction,
  tripId,
  autoSendAt,
  paused,
  failed,
  nowMs,
  autoSendAtLabel,
  copy,
}: {
  sendAction: (formData: FormData) => void;
  togglePauseAction: (formData: FormData) => void;
  tripId: string;
  autoSendAt: string | null;
  paused: boolean;
  failed?: boolean;
  /** Server-rendered start time keeps the first client render deterministic. */
  nowMs: number;
  /** The exact scheduled instant shown when staff hover the live duration. */
  autoSendAtLabel?: string;
  copy: RecapSendControlCopy;
}) {
  const dueAtMs = autoSendAt ? Date.parse(autoSendAt) : null;
  const [currentMs, setCurrentMs] = useState(nowMs);
  const remainingMs = dueAtMs !== null ? dueAtMs - currentMs : null;

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  let statusText: string;
  let isFailed = false;
  if (!autoSendAt || dueAtMs === null) {
    statusText = copy.noScheduledReturn;
  } else if (failed) {
    statusText = copy.failed;
    isFailed = true;
  } else if (paused) {
    statusText = copy.paused;
  } else if (remainingMs !== null && remainingMs <= 0) {
    statusText = copy.due;
  } else if (remainingMs !== null) {
    statusText = copy.waiting;
  } else {
    statusText = copy.noScheduledReturn;
  }

  const canTogglePause = autoSendAt !== null;

  return (
    <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p
        aria-live="polite"
        className={`text-sm ${isFailed ? "font-medium text-danger" : "text-muted"}`}
      >
        {statusText === copy.waiting && remainingMs !== null ? (
          <>
            {copy.waiting.split("{remaining}")[0]}
            <span title={autoSendAtLabel} className="whitespace-nowrap">
              {remainingLabel(remainingMs, copy.lessThanMinute)}
            </span>
            {copy.waiting.split("{remaining}").slice(1).join("{remaining}")}
          </>
        ) : (
          statusText
        )}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {canTogglePause && (
          <form action={togglePauseAction}>
            <input type="hidden" name="tripId" value={tripId} />
            <input type="hidden" name="paused" value={paused ? "false" : "true"} />
            <SubmitButton
              pendingLabel={paused ? copy.unpausing : copy.pausing}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {paused ? copy.unpause : copy.pause}
            </SubmitButton>
          </form>
        )}
        <form action={sendAction}>
          <input type="hidden" name="tripId" value={tripId} />
          <SubmitButton
            pendingLabel={copy.sending}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.send}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
