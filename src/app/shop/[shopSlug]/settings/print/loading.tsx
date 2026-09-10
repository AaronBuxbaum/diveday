import { sectionCardClass } from "@/components/ui/card";

/** The register's shape: the header, then the groups of sheet rows. */
export default function SettingsPrintLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 animate-pulse px-4 py-8 sm:px-6">
      <div className="h-4 w-24 rounded bg-surface-sunken" />
      <div className="mt-2 h-9 w-40 rounded bg-surface-sunken" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-surface-sunken" />
      <div className="mt-8 space-y-8">
        <div className={sectionCardClass({ padding: "none", className: "h-32 w-full" })} />
        <div className={sectionCardClass({ padding: "none", className: "h-32 w-full" })} />
        <div className={sectionCardClass({ padding: "none", className: "h-20 w-full" })} />
      </div>
    </main>
  );
}
