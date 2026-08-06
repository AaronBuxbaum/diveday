import type { OfflineManifestFreshness } from "@/lib/offline-manifests";

// text-success / text-warning alone on their own tinted fill measure just
// under AA at pill text sizes (see src/components/ui/badge.tsx) — -strong is
// the same hue, nudged dark enough to clear 4.5:1.
const freshnessToneClass: Record<OfflineManifestFreshness, string> = {
  current: "border-success/30 bg-success/10 text-success-strong",
  aging: "border-warning/40 bg-warning/10 text-warning-strong",
  stale: "border-danger/30 bg-danger/10 text-danger",
};

/**
 * The "how old is this saved copy" pill shown wherever an offline manifest
 * surfaces (the per-trip viewer, the saved-trips list, the manifest manager
 * card). One implementation for the tone-per-freshness mapping — this used to
 * be a triple ternary pasted at three call sites, and the copies had already
 * drifted apart (`py-1.5` vs `py-2`).
 */
export function OfflineFreshnessPill({
  freshness,
  className = "",
  children,
}: {
  freshness: OfflineManifestFreshness;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-sm font-bold ${
        freshnessToneClass[freshness]
      }${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}
