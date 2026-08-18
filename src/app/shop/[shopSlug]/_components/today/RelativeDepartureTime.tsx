"use client";

import { useEffect, useState } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** A live, compact departure-relative time with the exact instant on hover. */
export function RelativeDepartureTime({
  at,
  locale,
  timeZone,
  nowMs = Date.now(),
}: {
  at: Date | string;
  locale: string;
  timeZone: string;
  nowMs?: number;
}) {
  const atMs = typeof at === "string" ? Date.parse(at) : at.getTime();
  const [currentMs, setCurrentMs] = useState(nowMs);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const deltaMs = atMs - currentMs;
  if (!Number.isFinite(atMs) || Math.abs(deltaMs) > DAY_MS) return null;

  const direction = deltaMs < 0 ? -1 : 1;
  const absoluteMs = Math.abs(deltaMs);
  const unit = absoluteMs >= HOUR_MS ? "hour" : "minute";
  const unitMs = unit === "hour" ? HOUR_MS : MINUTE_MS;
  const amount = Math.max(1, Math.round(absoluteMs / unitMs));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(
    direction * amount,
    unit,
  );
  const exact = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(atMs));

  return (
    <time dateTime={new Date(atMs).toISOString()} title={exact} className="whitespace-nowrap">
      {relative}
    </time>
  );
}
