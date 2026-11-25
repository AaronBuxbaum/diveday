import { formatDateTimeTz, formatMoneyCents } from "@/lib/format";
import type { TripCreditKind, TripCreditReason } from "@/lib/trip-credit";

type Entry = {
  id: string;
  kind: TripCreditKind;
  reason: TripCreditReason | null;
  amountCents: number;
  currency: string;
  occurredAt: Date;
};

/** A referral grant reads as what the diver did; every other entry by its kind. */
export function tripCreditEntryKey(entry: Pick<Entry, "kind" | "reason">) {
  return entry.kind === "grant" && entry.reason === "referral"
    ? ("divers.tripCredit.kinds.referral" as const)
    : (`divers.tripCredit.kinds.${entry.kind}` as const);
}

/** The diver record's recent trip-credit lines, newest first; nothing when there are none. */
export function TripCreditHistory({
  entries,
  locale,
  timezone,
  title,
  kindLabel,
}: {
  entries: readonly Entry[];
  locale: string;
  timezone: string;
  title: string;
  kindLabel: (entry: Entry) => string;
}) {
  if (!entries.length) return null;
  return (
    <div className="mt-5">
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 divide-y divide-border">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap justify-between gap-3 py-2 text-sm">
            <span>
              {kindLabel(entry)} · {formatDateTimeTz(entry.occurredAt, locale, timezone)}
            </span>
            <span>
              {entry.kind === "redeem" ? "−" : "+"}
              {formatMoneyCents(entry.amountCents, entry.currency, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
