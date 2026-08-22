"use client";

import { useEffect, useState } from "react";

export type ConnectivityStatusCopy = {
  online: string;
  onlineTitle: string;
  offlineTitle: string;
};

export function ConnectivityStatus({
  offlineLabel,
  onlyWhenOffline = false,
  className = "",
  copy,
}: {
  /** What "offline" means on this surface (the manifest has a device copy; a
   * live-only surface like boarding warns its board may be stale instead). */
  offlineLabel: string;
  /**
   * Render nothing at all while the connection is up.
   *
   * **For a surface where connectivity is not the subject.** On the offline
   * manifest it is — the card around this pill is *about* the device copy, and
   * "Online" there answers the question the card raises. On a live-only board
   * like Today or the counter queue, a permanently green "Online" badge under
   * the page title says nothing a reader could get wrong without it, on the two
   * screens a shop looks at most; what earns its room is the warning. The
   * absence of a badge reads as "fine", which is exactly what it means.
   */
  onlyWhenOffline?: boolean;
  /**
   * Extra classes on the pill itself — spacing included.
   *
   * **Not a wrapper element, deliberately.** With `onlyWhenOffline` this
   * component renders `null`, and a wrapper carrying the margin still occupies
   * that margin: an empty `<span className="mt-2 inline-flex">` left 24px of
   * dead space under the page title and moved forty visual surfaces while
   * showing nothing at all. Spacing that belongs to a thing has to disappear
   * with the thing.
   */
  className?: string;
  copy: ConnectivityStatusCopy;
}) {
  // Start "online" so the server render and the first client render agree — a
  // navigator.onLine read in the initializer differs across the boundary and
  // trips a hydration mismatch on any server-rendered surface. The effect
  // reconciles to the real state immediately after mount.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online && onlyWhenOffline) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      title={online ? copy.onlineTitle : copy.offlineTitle}
      className={
        // Badge doesn't fit here (role/title/live-region props, min-h-9, its
        // own glyph pair) — but the AA rule from ui/badge.tsx still applies:
        // -strong text on the tinted fill.
        `${
          online
            ? "border-success/30 bg-success/10 text-success-strong"
            : "border-warning/40 bg-warning/10 text-warning-strong"
        } inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold ${className}`
      }
    >
      <span aria-hidden="true" className="text-base leading-none">
        {online ? "●" : "×"}
      </span>
      {online ? copy.online : offlineLabel}
    </span>
  );
}
