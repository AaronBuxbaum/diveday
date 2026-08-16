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

/**
 * The manual send control deliberately waits for the exact same moment as the
 * server-side recap scheduler. The live clock is just an affordance: the
 * server action rechecks the four-hour floor before it sends anything.
 */
export function RecapSendControl({
  action,
  eligibleAt,
  nowMs,
  copy,
}: {
  action: (formData: FormData) => void;
  eligibleAt: string;
  /** Server-rendered start time keeps the first client render deterministic. */
  nowMs: number;
  copy: {
    waiting: string;
    ready: string;
    send: string;
    sending: string;
    lessThanMinute: string;
  };
}) {
  const dueAtMs = Date.parse(eligibleAt);
  const [currentMs, setCurrentMs] = useState(nowMs);
  const remainingMs = dueAtMs - currentMs;
  const canSend = remainingMs <= 0;

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
      <p aria-live="polite" className="text-sm text-muted">
        {canSend
          ? copy.ready
          : copy.waiting.replace("{remaining}", remainingLabel(remainingMs, copy.lessThanMinute))}
      </p>
      <form action={action} className="shrink-0">
        <SubmitButton
          pendingLabel={copy.sending}
          disabled={!canSend}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.send}
        </SubmitButton>
      </form>
    </div>
  );
}
