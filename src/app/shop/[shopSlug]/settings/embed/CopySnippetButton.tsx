"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/** Copies a snippet to the clipboard with a brief acknowledgment, mirroring DownloadExportButton. */
export function CopySnippetButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={buttonClass({ variant: "secondary", size: "sm" })}
      aria-live="polite"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard permission denied or unavailable — the snippet is still
          // selectable text in the box above, so nothing is actually lost.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
