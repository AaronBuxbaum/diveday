"use client";

import { useOnline } from "@/components/use-online";

export type ConnectivityStatusCopy = {
  online: string;
  onlineTitle: string;
  offlineTitle: string;
};

export function ConnectivityStatus({
  offlineLabel,
  unanswered,
  onlyWhenOffline = false,
  className = "",
  copy,
}: {
  /** What "offline" means on this surface (the manifest has a device copy; a
   * live-only surface like boarding warns its board may be stale instead). */
  offlineLabel: string;
  /**
   * The device is online but the server did not answer it, and this surface
   * knows it (the offline manifest the service worker opened for a live page
   * that timed out). Drawn in the offline tone: "Online" there would read as
   * "this is live" on a copy that is not.
   */
  unanswered?: { label: string; title: string };
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
  const online = useOnline();

  const connected = online && !unanswered;
  if (connected && onlyWhenOffline) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      title={connected ? copy.onlineTitle : online ? unanswered?.title : copy.offlineTitle}
      className={
        // Badge doesn't fit here (role/title/live-region props, min-h-9, its
        // own glyph pair) — but the AA rule from ui/badge.tsx still applies:
        // -strong text on the tinted fill.
        `${
          connected
            ? "border-success/30 bg-success-tint text-success-strong"
            : "border-warning/40 bg-warning-tint text-warning-strong"
        } inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold ${className}`
      }
    >
      <span aria-hidden="true" className="text-base leading-none">
        {connected ? "●" : "×"}
      </span>
      {connected ? copy.online : online ? unanswered?.label : offlineLabel}
    </span>
  );
}
