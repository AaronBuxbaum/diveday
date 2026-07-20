import { formatShortDate, formatTimeRange } from "@/lib/format";
import type { Shop, Trip } from "./types";

export function TripHeader({ shop, trip }: { shop: Shop; trip: Trip }) {
  return (
    <header className="mt-4">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{trip.title}</h1>
      <p className="mt-2 text-lg text-muted">
        {formatShortDate(trip.startsAt, "en-US", shop.timezone)} ·{" "}
        {formatTimeRange(trip.startsAt, trip.endsAt, "en-US", shop.timezone)}
      </p>
      {trip.course ? (
        <p className="mt-2 text-sm font-medium text-primary">
          Course session · {trip.course.title}
        </p>
      ) : null}
      {trip.description ? <p className="mt-3 text-muted">{trip.description}</p> : null}
      {trip.priceCents !== null ? (
        <p className="mt-3 text-lg font-semibold tabular-nums">
          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
            trip.priceCents / 100,
          )}{" "}
          <span className="text-sm font-normal text-muted">per diver</span>
        </p>
      ) : null}
    </header>
  );
}
