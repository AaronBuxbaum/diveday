import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { scopedId } from "@/lib/element-id";
import type { PrepView } from "./prep-view";

/** The hotel run, kept on a cancellation: it is the list of lobbies to phone. */
export function PrepPickups({ view }: { view: PrepView }) {
  const { prep, t, idPrefix } = view;
  const { hotelPickups } = prep;
  return (
    <>
      {hotelPickups.length > 0 ? (
        <section aria-labelledby={scopedId(idPrefix, "hotel-pickups-heading")}>
          {/* `items-baseline`, as `SectionCard`'s header: the count is
                  words beside the title's words, so they share a line. */}
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={scopedId(idPrefix, "hotel-pickups-heading")} className={SECTION_TITLE_CLASS}>
              {t("tripPrep.hotelPickupsHeading")}
            </h2>
            <span className="text-sm text-muted">
              {t("tripPrep.hotelPickupsCount", { count: hotelPickups.length })}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{t("tripPrep.hotelPickupsDescription")}</p>
          <div className="mt-3 sm:hidden">
            <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface shadow-bed">
              {hotelPickups.map((pickup) => (
                <li key={pickup.bookingId} className="px-4 py-3">
                  <p className="font-medium tabular-nums">
                    {pickup.pickupTime ?? (
                      <span className="text-muted">{t("tripPrep.pickupTimeUnset")}</span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {pickup.hotelPickupLocation} · {pickup.diverName}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <Table shellClassName="mt-3 hidden sm:block">
            <THead>
              <Th>{t("tripPrep.pickupTimeColumn")}</Th>
              <Th>{t("tripPrep.pickupHotelColumn")}</Th>
              <Th>{t("tripPrep.pickupDiverColumn")}</Th>
            </THead>
            <TBody>
              {hotelPickups.map((pickup) => (
                <tr key={pickup.bookingId}>
                  <Td className="font-medium">
                    {pickup.pickupTime ?? (
                      <span className="text-muted">{t("tripPrep.pickupTimeUnset")}</span>
                    )}
                  </Td>
                  <Td className="font-medium">{pickup.hotelPickupLocation}</Td>
                  <Td>{pickup.diverName}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </section>
      ) : null}
    </>
  );
}
