import { dockDayTimeline } from "@/lib/diver-planning";
import type { Shop, Trip } from "./types";

export function PackingSection({ shop, trip }: { shop: Shop; trip: Trip }) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Pack with confidence</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
        {shop.packingList.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <h3 className="mt-5 font-semibold">Your dock-day rhythm</h3>
      <ol className="mt-2 space-y-1 text-sm text-muted">
        {dockDayTimeline(trip.startsAt).map((step) => (
          <li key={step.label}>
            {step.label} ·{" "}
            {step.at.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: shop.timezone,
            })}
          </li>
        ))}
      </ol>
    </section>
  );
}
