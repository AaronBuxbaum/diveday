import Link from "next/link";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { buttonClass } from "@/components/ui/button";
import type { getDb } from "@/db/client";
import type { ReadyPageData } from "@/db/ready";
import type { DiverTranslator } from "@/i18n/messages";
import { publicSchedulePath } from "@/lib/public-routes";
import { CarriedPreparation } from "./CarriedPreparation";

/**
 * The card a diver stranded by a called-off departure reads: the departure is
 * cancelled, here is the shop to ask, here is what they had already told the
 * shop, and here is what is on next. Terminal, with no form on it, so it
 * authorizes nothing; the page decides whether it is owed (the `!capability`
 * block in `page.tsx`, the only place a cancelled departure's token arrives).
 */
export function TripCancelledCard({
  db,
  data,
  t,
}: {
  db: Awaited<ReturnType<typeof getDb>>;
  data: ReadyPageData;
  t: DiverTranslator;
}) {
  return (
    <ExpiredLinkCard
      glyph="cancelled"
      title={t("booking.cancelledHeading")}
      text={t("ready.tripCancelledBody")}
      shop={{
        name: data.detail.shop.name,
        contactEmail: data.shop.contactEmail,
        contactPhone: data.shop.contactPhone,
      }}
      t={t}
    >
      <CarriedPreparation db={db} data={data} t={t} />
      <Link href={publicSchedulePath(data.shop.slug)} className={buttonClass()}>
        {t("recap.seeWhatsNext")}
      </Link>
    </ExpiredLinkCard>
  );
}
