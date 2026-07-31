"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * Copies an absolute URL built from a relative `path` at click time — never a
 * server-rendered origin, which would bake in whatever host rendered the page
 * (a preview deployment, a different custom domain) instead of the one the
 * staffer is actually looking at.
 */
export function CopyLinkButton({
  path,
  label,
  copiedLabel,
}: {
  path: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={buttonClass({ variant: "secondary", size: "sm" })}
    >
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
