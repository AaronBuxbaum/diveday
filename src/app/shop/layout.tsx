import { DemoBanner } from "@/components/DemoBanner";
import { isDemoMode } from "@/lib/demo";

/**
 * Staff-surface shell. In demo mode it hangs the demo banner (with its reset)
 * above every /shop page so the "this is a playground" framing is always present
 * (docs ADR 20260718-demo-mode).
 */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {isDemoMode() ? <DemoBanner /> : null}
      {children}
    </>
  );
}
