import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import type { Shop } from "@/db/schema";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **A recap that waits while somebody on the boat is "not back aboard"**
 * (issue #2123, `bookingsWaitingOnAMissingPerson` in src/db/recap.ts). Shared
 * by `/recap` and the after-dive `/ready`, so the two links say the same thing.
 *
 * Whoever holds the link may be family, so it says only that the recap is not
 * ready: never why, and never the no-show card, which would tell them the
 * diver never sailed. The same link works again once the crew correct the word.
 */
export function RecapWaitingCard({
  shop,
  t,
}: {
  shop: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t: DiverTranslator;
}) {
  return (
    <ExpiredLinkCard
      title={t("recap.waitingHeading")}
      text={t("recap.waitingBody")}
      shop={shop}
      t={t}
    />
  );
}
