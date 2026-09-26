import { sectionCardClass } from "@/components/ui/card";
import { settingsPaneClass } from "../_components/settings-pane";

/** The register's shape: the header, then the groups of sheet rows. */
export default function SettingsPrintLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-40 rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 space-y-8">
          <div className={sectionCardClass({ padding: "none", className: "h-32 w-full" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-32 w-full" })} />
          <div className={sectionCardClass({ padding: "none", className: "h-20 w-full" })} />
        </div>
      </div>
    </main>
  );
}
