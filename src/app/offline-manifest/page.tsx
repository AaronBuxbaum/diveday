import type { Metadata } from "next";
import { OfflineManifestView } from "@/components/OfflineManifestView";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline boat manifest — Scuba",
  robots: { index: false, follow: false },
};

export default function OfflineManifestPage() {
  return <OfflineManifestView />;
}
