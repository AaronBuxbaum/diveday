"use client";

import { Copyable } from "@/components/Copyable";

/**
 * Copies an absolute URL built from a relative `path` — resolved against
 * `window.location.origin` at render time, never a server-rendered origin,
 * which would bake in whatever host rendered the page (a preview
 * deployment, a different custom domain) instead of the one the staffer is
 * actually looking at. Server-rendered markup has no `window`, so the first
 * paint falls back to the bare path; the client render right after hydration
 * replaces it with the real absolute URL.
 */
export function CopyLinkButton({
  path,
  label,
  copiedLabel,
  failedLabel,
}: {
  path: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const url =
    typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();

  return (
    <Copyable
      layout="inline"
      value={url}
      copyLabel={label}
      copiedLabel={copiedLabel}
      failedLabel={failedLabel}
    />
  );
}
