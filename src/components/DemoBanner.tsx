import { resetDemoAction } from "@/app/actions/demo";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Persistent demo-mode marker on the staff surfaces: names the experience for
 * what it is (an example shop, shared, wipeable) and offers the one-click reset.
 * Rendered by the /shop layout only when isDemoMode() (docs ADR 20260718-demo-mode).
 */
export function DemoBanner() {
  return (
    <div className="border-b border-accent/40 bg-accent/10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          <span className="font-semibold text-accent">Demo shop.</span> Explore freely — this is
          example data, shared by everyone trying Scuba.
        </p>
        <form action={resetDemoAction} className="shrink-0">
          <SubmitButton
            pendingLabel="Resetting…"
            className="min-h-9 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-sunken disabled:opacity-70"
          >
            Reset demo data
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
