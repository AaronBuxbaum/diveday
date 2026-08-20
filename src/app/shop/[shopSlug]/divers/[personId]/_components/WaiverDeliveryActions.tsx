"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  IDLE_WAIVER_SEND_STATE,
  type WaiverSendChannel,
  type WaiverSendCopy,
  type WaiverSendState,
} from "@/app/actions/waiver-send-types";
import { sendWaiversAction } from "@/app/actions/waivers";
import { copyToClipboard } from "@/components/Copyable";
import { Toast } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";
import {
  WaiverActionIcon,
  type WaiverActionIconName,
  WaiverDeliveryMark,
  type WaiverDeliveryMarkName,
} from "@/components/WaiverActionIcon";
import type { WaiverChannelDeliveryState, WaiverChannelDeliveryStates } from "@/db/waivers";
import { fill } from "@/i18n/fill";

/** The words on the three delivery buttons, resolved server-side. */
export type WaiverDeliveryCopy = {
  email: string;
  text: string;
  link: string;
  /** What each channel's last outcome is called, for the button's own name. */
  stateSent: string;
  stateFailed: string;
  stateUnavailable: string;
};

/**
 * How a button wears what we last knew about its channel: a ring the eye
 * catches from across a counter, and a mark whose *shape* says the same thing
 * for anyone the ring's hue does not reach.
 *
 * `unknown` — nobody has tried this way on this link — deliberately draws
 * nothing. An "untried" badge on every button on every unsigned waiver would be
 * the absence of information formatted as information (design principle 9), and
 * it would make the one button that *has* something to say invisible.
 */
const CHANNEL_STATE: Record<
  Exclude<WaiverChannelDeliveryState, "unknown">,
  { ring: string; ink: string; mark: WaiverDeliveryMarkName }
> = {
  sent: { ring: "ring-2 ring-success/50", ink: "text-success", mark: "sent" },
  failed: { ring: "ring-2 ring-danger/55", ink: "text-danger", mark: "failed" },
  not_configured: { ring: "ring-2 ring-warning/55", ink: "text-warning", mark: "unavailable" },
};

function stateWord(state: WaiverChannelDeliveryState, copy: WaiverDeliveryCopy): string | null {
  if (state === "sent") return copy.stateSent;
  if (state === "failed") return copy.stateFailed;
  if (state === "not_configured") return copy.stateUnavailable;
  return null;
}

/**
 * The one-line toast for an outcome the buttons' own rings can't carry: a
 * genuine send (names who it reached), a double-tap that changed nothing, or
 * a hard failure unrelated to any one channel. `null` for everything a
 * ring/mark already says (sent/failed/unavailable) or that the caller handles
 * itself (the "Copy link" clipboard write, which needs its own async result).
 */
function outcomeToast(state: WaiverSendState, copy: WaiverSendCopy): string | null {
  if (state.sent.length > 0) return fill(copy.sent, { names: state.sent.join(", ") });
  if (state.alreadyDone.length > 0) {
    return fill(state.alreadyDone.length === 1 ? copy.alreadyDoneOne : copy.alreadyDoneOther, {
      names: state.alreadyDone.join(", "),
    });
  }
  if (state.errors.length > 0) return fill(copy.errors, { names: state.errors.join(", ") });
  return null;
}

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
  state = "unknown",
  stateLabel,
  tapped,
  onTap,
}: {
  channel: WaiverSendChannel;
  icon: WaiverActionIconName;
  label: string;
  pendingLabel: string;
  /** What we last knew about this channel on the diver's outstanding link. */
  state?: WaiverChannelDeliveryState;
  /** That state in words — the button's accessible name carries it. */
  stateLabel?: string | null;
  /** Which button started the submit that is in flight, so only it swaps label. */
  tapped: WaiverSendChannel | null;
  onTap: (channel: WaiverSendChannel) => void;
}) {
  const { pending } = useFormStatus();
  const busy = pending && tapped === channel;
  const mark = state === "unknown" ? null : CHANNEL_STATE[state];
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
      // The ring, not a border or a text colour: `secondary` already owns both
      // of those, and two utilities for one property resolve by stylesheet
      // order rather than by which one you wrote last (see `ui/button.ts`).
      // Nothing here competes with the variant.
      className={buttonClass({
        variant: "secondary",
        size: "sm",
        busy: true,
        className: mark ? `gap-2 ${mark.ring}` : "gap-2",
      })}
    >
      {busy ? (
        pendingLabel
      ) : (
        <>
          <WaiverActionIcon name={icon} />
          {label}
          {mark ? (
            <span className={mark.ink}>
              <WaiverDeliveryMark name={mark.mark} />
            </span>
          ) : null}
          {/* Free to add and invisible to everyone else, so it is never the
              thing traded away (docs/design/accessibility-tradeoffs.md). */}
          {stateLabel ? <span className="sr-only">{stateLabel}</span> : null}
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
  channelStates,
  copy,
  sendCopy,
  children,
}: {
  shopSlug: string;
  personId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  /**
   * What each way of sending last did on this diver's outstanding link. Read
   * from the server on every render — the send action revalidates this page —
   * so a button's ring is the truth after the tap, not an optimistic guess.
   */
  channelStates: WaiverChannelDeliveryStates;
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
  // Bumped on every tap so a repeat of the same outcome still remounts the
  // toast below instead of sitting inert as an unchanged prop.
  const [attempt, setAttempt] = useState(0);
  const tap = (channel: WaiverSendChannel) => {
    setTapped(channel);
    setAttempt((count) => count + 1);
  };

  const [toast, setToast] = useState<{ attempt: number; message: string } | null>(null);
  useEffect(() => {
    if (state.status !== "done") return;
    const message = outcomeToast(state, sendCopy);
    if (message) {
      setToast({ attempt, message });
      return;
    }
    // The one outcome with no trace elsewhere on screen: a deliberate "Copy
    // link" tap has no ring of its own (see the comment below), so this is
    // the only place the clipboard write gets acknowledged. An email/text
    // fallback link — the send failed, or the channel isn't configured —
    // stays silent here on purpose: the button's own ring already says so,
    // and "Copy link" is the button right next to it. Clearing any standing
    // toast rather than merely skipping matters here: a tap that lands while
    // an earlier tap's toast is still up (well within its four seconds) must
    // not leave that older, now-unrelated message sitting on screen looking
    // like it answers this one.
    if (state.channel !== "link" || !state.links[0]) {
      setToast(null);
      return;
    }
    const url = new URL(`/waivers/${state.links[0].token}`, window.location.origin).toString();
    let alive = true;
    void copyToClipboard(url).then((ok) => {
      if (alive) setToast({ attempt, message: ok ? sendCopy.copied : sendCopy.copyFailed });
    });
    return () => {
      alive = false;
    };
  }, [state, sendCopy, attempt]);

  return (
    <>
      <div className="mt-5 flex flex-wrap items-start gap-2">
        <form action={formAction} className="contents">
          <input type="hidden" name="personId" value={personId} />
          {hasEmail ? (
            <ChannelButton
              channel="email"
              icon="email"
              label={copy.email}
              pendingLabel={sendCopy.sending}
              state={channelStates.email}
              stateLabel={stateWord(channelStates.email, copy)}
              tapped={tapped}
              onTap={tap}
            />
          ) : null}
          {hasPhone ? (
            <ChannelButton
              channel="text"
              icon="text"
              label={copy.text}
              pendingLabel={sendCopy.sending}
              state={channelStates.text}
              stateLabel={stateWord(channelStates.text, copy)}
              tapped={tapped}
              onTap={tap}
            />
          ) : null}
          {/* No ring on the link. Taking a URL is not a delivery that can fail,
              and "you copied this once" is not a state anyone needs a mark for
              — the control's own "Copied" already said so at the moment it
              mattered (design principle 9). */}
          <ChannelButton
            channel="link"
            icon="link"
            label={copy.link}
            pendingLabel={sendCopy.sending}
            tapped={tapped}
            onTap={tap}
          />
        </form>
        {children}
      </div>
      {toast ? <Toast key={toast.attempt} message={toast.message} /> : null}
    </>
  );
}
