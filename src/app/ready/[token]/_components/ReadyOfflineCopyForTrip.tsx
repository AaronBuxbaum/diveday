import { ReadyOfflineCopy } from "@/app/ready/[token]/_components/ReadyOfflineCopy";
import { readyOfflineWords } from "@/app/ready/[token]/_components/ready-offline-words";
import type { DiverTranslator } from "@/i18n/messages";
import { nowMs } from "@/lib/clock";
import { readyCopyKeepUntil } from "@/lib/ready-offline";

/** Stamp the server-generated page, not the diver's device clock. */
export function ReadyOfflineCopyForTrip({
  detail,
  locale,
  t,
}: {
  detail: { trip: { startsAt: Date; endsAt?: Date | null }; shop: { timezone: string } };
  locale: string;
  t: DiverTranslator;
}) {
  return (
    <ReadyOfflineCopy
      copy={readyOfflineWords(t)}
      keepUntil={readyCopyKeepUntil(detail.trip)}
      locale={locale}
      timeZone={detail.shop.timezone}
      generatedAt={nowMs()}
    />
  );
}
