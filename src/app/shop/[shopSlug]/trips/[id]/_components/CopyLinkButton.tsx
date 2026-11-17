"use client";

import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

/**
 * Copies an absolute URL built from a relative `path` — resolved against
 * `window.location.origin` at the tap, never a server-rendered origin, which
 * would bake in whatever host rendered the page (a preview deployment, a
 * different custom domain) instead of the one the staffer is looking at.
 *
 * **It cannot fail into "select the link above"**: the button stands alone on
 * its row, so when the clipboard refuses, the link itself appears under it,
 * focused and selected, for the staffer's own copy.
 */
export function CopyLinkButton({
  path,
  label,
  copiedLabel,
  failedLabel,
  flush = false,
  variant = "ghost",
}: {
  path: string;
  label: string;
  copiedLabel: string;
  /** Names the link field the failure shows. */
  failedLabel: string;
  /** The button starts a line: its word sits on that line's edge. */
  flush?: boolean;
  /** `secondary` where the copy is a row's one button (Filling's booking link). */
  variant?: "ghost" | "secondary";
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [url, setUrl] = useState(path);
  const field = useRef<HTMLInputElement>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (status !== "failed") return;
    field.current?.focus();
    field.current?.select();
  }, [status]);
  useEffect(() => () => clearTimeout(reset.current), []);

  async function copy() {
    const absolute = new URL(path, window.location.origin).toString();
    setUrl(absolute);
    if (await copyToClipboard(absolute)) {
      setStatus("copied");
      clearTimeout(reset.current);
      reset.current = setTimeout(() => setStatus("idle"), 4000);
    } else {
      setStatus("failed");
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={copy}
        className={buttonClass({ variant, size: "sm", flush: variant === "ghost" && flush })}
      >
        <span aria-live="polite">{status === "copied" ? copiedLabel : label}</span>
      </button>
      {status === "failed" ? (
        <input
          ref={field}
          readOnly
          value={url}
          aria-label={failedLabel}
          onFocus={(event) => event.currentTarget.select()}
          className={`${controlClass} min-w-0 max-w-full font-mono text-xs`}
        />
      ) : null}
    </span>
  );
}
