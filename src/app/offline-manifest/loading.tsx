import { OfflineManifestSkeleton } from "@/components/offline-manifest/ShellScreens";

/**
 * Body-shaped skeleton for `/offline-manifest` (UX audit 2026-10-07, item
 * 42). The view is client-only — it reads an encrypted IndexedDB snapshot with
 * the radio off — so this is what a captain sees between the cached shell and
 * the first read. The page uses it as its own `<Suspense>` fallback as well,
 * which is what the static shell paints; the view draws the same skeleton
 * until it knows the device's language.
 */
export default function OfflineManifestLoading() {
  return <OfflineManifestSkeleton />;
}
