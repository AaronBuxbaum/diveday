"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * The download link with a brief acknowledgment, same shape as the shop-wide
 * export's own button (`settings/export/DownloadExportButton.tsx`) — kept as
 * its own small copy here rather than a shared import, matching this app's
 * per-page `_components` convention: a five-line client component costs less
 * to duplicate once than a cross-route import costs to keep straight.
 */
export function DownloadDiverExportButton({
  href,
  idleLabel,
  acknowledgedLabel,
}: {
  href: string;
  idleLabel: string;
  acknowledgedLabel: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <a
      href={href}
      download
      className={buttonClass({ variant: "secondary" })}
      aria-live="polite"
      onClick={() => {
        setAcknowledged(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAcknowledged(false), 2500);
      }}
    >
      {acknowledged ? acknowledgedLabel : idleLabel}
    </a>
  );
}
