import Link from "next/link";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { getDb } from "@/db/client";
import type { StrandedMoveAsk } from "@/db/move-offer";
import type { ReadyPageData } from "@/db/ready";
import type { DiverTranslator } from "@/i18n/messages";
import { formatPlannedDateTimeTz } from "@/lib/format";
import { publicSchedulePath } from "@/lib/public-routes";
import { CarriedPreparation } from "./CarriedPreparation";

/**
 * The card a diver stranded by a called-off departure reads: the departure is
 * cancelled, here is the shop to ask, here is what they had already told the
 * shop, and here is what is on next. The page decides whether it is owed (the
 * `!capability` block in `page.tsx`, the only place a cancelled departure's
 * token arrives).
 *
 * **One boat to ask for** (UX sheet 2026-10-22, item 5; H-20261022-called-off-boat-offers). Where the
 * shop runs another departure of the same kind at the same price or lower
 * with a seat free, the card offers it as "Ask to move to …": an ordinary
 * move ask the desk confirms, never a move. `moveAsk` is computed by
 * `strandedMoveAsk` only for a link `verifyStrandedBookingCapability`
 * accepts, and the action computes it again before filing anything. Null
 * leaves the card as it was: no form on it, authorizing nothing.
 */
export function TripCancelledCard({
  db,
  data,
  t,
  locale,
  moveAsk = null,
  action,
  notice = null,
}: {
  db: Awaited<ReturnType<typeof getDb>>;
  data: ReadyPageData;
  t: DiverTranslator;
  locale: string;
  moveAsk?: StrandedMoveAsk | null;
  /** `askToMoveFromCancelledAction`, bound to the link's token. */
  action?: (formData: FormData) => Promise<void>;
  /**
   * The last tap filed nothing: `move-ask` when the offer changed or went
   * since the page drew it, `rate` when the address was throttled.
   */
  notice?: "move-ask" | "rate" | null;
}) {
  const shopName = data.detail.shop.name;
  const offer = moveAsk?.state === "open" && action ? moveAsk.offer : null;
  return (
    <ExpiredLinkCard
      glyph="cancelled"
      title={t("booking.cancelledHeading")}
      // "Nothing you need to do" is untrue above a boat to ask for.
      text={
        offer ? t("ready.tripCancelledMoveBody", { shop: shopName }) : t("ready.tripCancelledBody")
      }
      shop={{
        name: shopName,
        contactEmail: data.shop.contactEmail,
        contactPhone: data.shop.contactPhone,
      }}
      t={t}
    >
      <CarriedPreparation db={db} data={data} t={t} />
      {notice ? (
        <p role="status" className="text-base text-danger">
          {t(notice === "rate" ? "ready.rateLimited" : "ready.moveAsk.unavailable")}
        </p>
      ) : null}
      {moveAsk?.state === "asked" ? (
        <p id="move-ask" className="text-base">
          {t("ready.moveAsk.asked", { shop: shopName })}
        </p>
      ) : null}
      {offer ? (
        <form id="move-ask" action={action} className="flex flex-col items-center gap-3">
          <p className="text-base text-muted">
            {t("ready.moveOffer.lead", { title: offer.title })}
          </p>
          <input type="hidden" name="tripId" value={offer.tripId} />
          <SubmitButton pendingLabel={t("ready.moveAsk.pending")} className={buttonClass()}>
            {t("ready.moveOffer.action", {
              when: formatPlannedDateTimeTz(offer.startsAt, locale, data.detail.shop.timezone),
            })}
          </SubmitButton>
        </form>
      ) : null}
      <Link
        href={publicSchedulePath(data.shop.slug)}
        className={buttonClass(offer ? { variant: "secondary" } : undefined)}
      >
        {t("recap.seeWhatsNext")}
      </Link>
    </ExpiredLinkCard>
  );
}
