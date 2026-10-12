import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { waiverRowStateText, waiverRowStateTone } from "@/i18n/waiver-labels";
import { counterRentalWaiverFlag } from "@/lib/counter-rentals";
import type { ShopWaiverStatus } from "@/lib/waivers";
import { WaiverSendControl } from "../../_components/today/WaiverSendControl";

/**
 * **The person's waiver, informing only** (issue #2261, H-108): a counter
 * rental never waits on it, so this is a line and a way to send the link,
 * never a gate. One component for the two places a counter says it: the
 * rental ticket, and the new-rental form while the person is still at the
 * counter choosing gear (issue #2346). Nothing renders for a current
 * signature, or when the standing was not read.
 *
 * The send is a `counter` send, so the held send refreshes the page the
 * staffer is on and is counted as a counter send, not a diver-record one.
 */
export function CounterRentalWaiverLine({
  t,
  state,
  personId,
  ticketId,
  className = "",
}: {
  t: StaffTranslator;
  state: ShopWaiverStatus["state"] | undefined;
  personId: string;
  /** The rental's ticket, once there is one; absent on the new-rental form. */
  ticketId?: string;
  className?: string;
}) {
  const flag = state ? counterRentalWaiverFlag(state) : null;
  if (!state || !flag) return null;
  return (
    <section className={`flex flex-wrap items-center justify-between gap-3 ${className}`.trim()}>
      <p
        className={`inline-flex items-baseline gap-1.5 font-medium ${
          waiverRowStateTone(state) === "danger" ? "text-danger" : "text-warning-strong"
        }`}
      >
        <span className="flex h-lh shrink-0 items-center self-start">
          <DiveDayIcon name="warning" className="size-4 shrink-0" />
        </span>
        <span>{t("gearRentals.waiver", { standing: waiverRowStateText(t, state) })}</span>
      </p>
      {flag.offerLink ? (
        <WaiverSendControl
          surface="counter"
          ticketId={ticketId}
          personId={personId}
          bookingIds={[]}
          label={t("gearRentals.sendWaiver")}
          copy={waiverSendCopy(t)}
        />
      ) : null}
    </section>
  );
}
