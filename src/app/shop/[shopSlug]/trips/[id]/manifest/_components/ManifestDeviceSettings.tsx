import { HapticsToggle } from "@/components/HapticsToggle";
import { PushOptIn } from "@/components/PushOptIn";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { webPushPublicKey } from "@/lib/notifications/web-push";
import {
  isPushSubscribedAction,
  isPushSubscribedAnywhereAction,
  subscribePushAction,
  unsubscribePushAction,
} from "../actions";
import { pushOptInCopy } from "./manifest-copy";

/**
 * **What this phone does**, inside the offline copy's disclosure: wake for a
 * refresh, and buzz. Per-device preferences, not facts about the departure.
 */
export function ManifestDeviceSettings({ tripId, t }: { tripId: string; t: StaffTranslator }) {
  return (
    <div className="grid gap-5">
      {/* Push is an optional device capability. The empty guard keeps a
        browser without notification support from leaving a blank inset
        behind while the device settings below keep their place. */}
      <div className="rounded-inset bg-surface-sunken/70 p-4 empty:hidden">
        <PushOptIn
          publicKey={webPushPublicKey()}
          subscribeAction={subscribePushAction.bind(null, tripId)}
          unsubscribeAction={unsubscribePushAction.bind(null, tripId)}
          isSubscribedAction={isPushSubscribedAction.bind(null, tripId)}
          isSubscribedAnyAction={isPushSubscribedAnywhereAction}
          copy={pushOptInCopy(t)}
        />
      </div>

      {/* A *this device* preference, not a checkpoint destination. It
        renders nothing on a phone with no vibration motor — which is
        every iPhone (src/components/haptics.ts) — and the empty guard
        keeps that from leaving a blank cell behind. */}
      <div className="grid gap-3 empty:hidden sm:grid-cols-2">
        <HapticsToggle
          copy={{ label: t("shared.haptics.toggleLabel") }}
          className="h-full w-full justify-start"
        />
      </div>
    </div>
  );
}
