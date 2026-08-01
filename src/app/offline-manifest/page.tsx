import type { Metadata } from "next";
import { Suspense } from "react";
import { OfflineManifestView } from "@/components/OfflineManifestView";

export const metadata: Metadata = {
  title: "Offline boat manifest — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * Replaces the former `dynamic = "force-static"` (invalid under Cache
 * Components). `OfflineManifestView` is entirely client-driven — it renders
 * from an encrypted IndexedDB snapshot with the radio off, not from anything
 * the server provides — and calls `useSearchParams()`, which always needs a
 * `<Suspense>` boundary now (docs: "blocking-prerender-client-hook"). That
 * boundary is exactly what restores the original static-shell intent: the
 * page prerenders (there is no server data to make it dynamic), and the
 * client component streams/hydrates as before.
 */
export default function OfflineManifestPage() {
  return (
    <Suspense fallback={null}>
      <OfflineManifestView />
    </Suspense>
  );
}
