"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * The download anchor with a brief acknowledgment: the browser gives no
 * in-page signal when a download starts, and this is the "yours to keep"
 * promise being fulfilled — it deserves a nod. Text-only swap, so it is
 * reduced-motion-safe by construction.
 */
export function DownloadExportButton({ href }: { href: string }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <a
      href={href}
      download
      className={buttonClass({ size: "lg" })}
      aria-live="polite"
      onClick={() => {
        setAcknowledged(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAcknowledged(false), 2500);
      }}
    >
      {acknowledged ? "On its way — check your downloads" : "Download export"}
    </a>
  );
}
