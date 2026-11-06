"use client";

import { useEffect, useRef, useState } from "react";
import { type ButtonVariant, buttonClass } from "@/components/ui/button";

/** A download link that briefly confirms the click, since browsers give no in-page signal. */
export function DownloadAcknowledgmentLink({
  href,
  idleLabel,
  acknowledgedLabel,
  variant = "primary",
}: {
  href: string;
  idleLabel: string;
  acknowledgedLabel: string;
  variant?: ButtonVariant;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <a
      href={href}
      download
      className={buttonClass({ variant })}
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
