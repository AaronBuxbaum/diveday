import { sectionCardClass } from "@/components/ui/card";

/** Body-shaped: three card bars, the height the grid usually paints at. */
export default function EmbedWidgetLoading() {
  return (
    <div className="animate-pulse p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((n) => (
          <div key={n} className={sectionCardClass({ padding: "none", className: "h-40" })} />
        ))}
      </div>
    </div>
  );
}
