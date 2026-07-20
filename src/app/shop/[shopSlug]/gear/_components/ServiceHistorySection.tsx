import { formatShortDate } from "@/lib/format";
import type { GearServiceEvent, Shop } from "./types";

export function ServiceHistorySection({
  serviceEvents,
  shop,
}: {
  serviceEvents: GearServiceEvent[];
  shop: Shop;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Recent service</h2>
      {serviceEvents.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Completed service will be recorded here.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {serviceEvents.slice(0, 12).map(({ service, item, staff }) => (
            <li key={service.id} className="px-4 py-3 text-sm">
              <p>
                <strong>{item.label}</strong> · {service.note}
              </p>
              <p className="mt-1 text-muted">
                {formatShortDate(service.serviceCompletedAt, "en-US", shop.timezone)} by{" "}
                {staff.fullName}
                {service.nextServiceDueAt
                  ? ` · next due ${formatShortDate(service.nextServiceDueAt, "en-US", shop.timezone)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
