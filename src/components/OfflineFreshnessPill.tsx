import type { OfflineManifestFreshness } from "@/lib/offline-manifests";

// `-strong` on the two hues that need it: on their own 10% fill the raw light
// tokens measure 4.39:1 / 4.38:1, under AA's 4.5, where `-strong` reads 4.84:1.
// `danger` clears it plainly (5.46:1). The rule and the full table are in
// docs/design/forms-and-controls.md.
const freshnessToneClass: Record<OfflineManifestFreshness, string> = {
  current: "border-success/30 bg-success/10 text-success-strong",
  aging: "border-warning/40 bg-warning/10 text-warning-strong",
  stale: "border-danger/30 bg-danger/10 text-danger",
};

/**
 * The same three hues as ink alone, for the line that names what to do about a
 * copy that is no longer current. It sits directly under the pill, so it has to
 * read as the same object rather than as ordinary muted text.
 */
export const freshnessInkClass: Record<OfflineManifestFreshness, string> = {
  current: "text-success-strong",
  aging: "text-warning-strong",
  stale: "text-danger",
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
