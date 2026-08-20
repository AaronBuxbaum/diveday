"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverSendChannel,
  type WaiverSendCopy,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { ResultNotice } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
import { WaiverActionIcon, type WaiverActionIconName } from "@/components/WaiverActionIcon";

/** The words on the three delivery buttons, resolved server-side. */
export type WaiverDeliveryCopy = {
  email: string;
  text: string;
  link: string;
};

/**
 * One button per way of handing a release over, all three submitting the **same
 * form**.
 *
 * That is the whole reason this exists rather than three `WaiverSendControl`s
 * side by side: three forms would be three independent `useActionState`s, so a
 * text send and an email send would each render their own outcome and the row
 * would end up claiming two different things at once. One form means one
 * in-flight submit, one result, and one place the answer appears. The channel
 * rides along as the submitter's own `name`/`value`, which is how a form knows
 * *which* button sent it.
 */
function ChannelButton({
  channel,
  icon,
  label,
  pendingLabel,
  tapped,
  onTap,
}: {
  channel: WaiverSendChannel;
  icon: WaiverActionIconName;
  label: string;
  pendingLabel: string;
  /** Which button started the submit that is in flight, so only it swaps label. */
  tapped: WaiverSendChannel | null;
  onTap: (channel: WaiverSendChannel) => void;
}) {
  const { pending } = useFormStatus();
  const busy = pending && tapped === channel;
  return (
    <button
      type="submit"
      name="channel"
      value={channel}
      // Every button in the row goes quiet for the one submit in flight: they
      // all post the same form, so a second tap would race the first.
      disabled={pending}
      aria-busy={busy}
      onClick={() => onTap(channel)}
      className={buttonClass({ variant: "secondary", size: "sm", busy: true, className: "gap-2" })}
    >
      {busy ? (
        pendingLabel
      ) : (
        <>
          <WaiverActionIcon name={icon} />
          {label}
        </>
      )}
    </button>
  );
}

/**
 * The diver record's waiver delivery row: mail it, text it, or take the link.
 *
 * Email and text are offered only when the record carries the address or number
 * they need — a button that can only ever answer "no email on file" is a dead
 * control on the one page where the fix (add the address) is two sections up.
 * The link is always offered, because a staffer with the diver in front of them
 * can always hand it over themselves.
 */
export function WaiverDeliveryActions({
  shopSlug,
  personId,
  hasEmail,
  hasPhone,
  copy,
  sendCopy,
  children,
}: {
  shopSlug: string;
  personId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  copy: WaiverDeliveryCopy;
  sendCopy: WaiverSendCopy;
  /**
   * The paper attestation, which belongs *in* the row as a fourth peer but not
   * in the form (it posts a different action). Passed as a slot so the row and
   * the outcome under it stay one layout with one owner — the alternative put
   * this component's result strip between the buttons and the paper trigger,
   * where an empty strip still claimed a line of the wrapping row.
   */
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(
    sendWaiversAction.bind(null, shopSlug, "diver", undefined),
    IDLE_WAIVER_SEND_STATE,
  );
  const [tapped, setTapped] = useState<WaiverSendChannel | null>(null);

  return (
    <>
      <div className="mt-5 flex flex-wrap items-start gap-2">
        <form action={formAction} className="contents">
          <input type="hidden" name="personId" value={personId} />
          {/* Every send exposes its fresh link. Staff on this page are as often
            reading the URL out loud as relying on delivery, and the link is the
            one artefact all three buttons produce. */}
          <input type="hidden" name="exposeLink" value="true" />
          {hasEmail ? (
            <ChannelButton
              channel="email"
              icon="email"
              label={copy.email}
              pendingLabel={sendCopy.sending}
              tapped={tapped}
              onTap={setTapped}
            />
          ) : null}
          {hasPhone ? (
            <ChannelButton
              channel="text"
              icon="text"
              label={copy.text}
              pendingLabel={sendCopy.sending}
              tapped={tapped}
              onTap={setTapped}
            />
          ) : null}
          <ChannelButton
            channel="link"
            icon="link"
            label={copy.link}
            pendingLabel={sendCopy.sending}
            tapped={tapped}
            onTap={setTapped}
          />
        </form>
        {children}
      </div>
      <ResultNotice state={state} copy={sendCopy} />
    </>
  );
}
