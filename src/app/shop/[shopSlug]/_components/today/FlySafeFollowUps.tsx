import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, proseLinkClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import { listShopFlySafeFollowUps } from "@/db/fly-safe-correction";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { acknowledgeFlySafeAction } from "./fly-safe-follow-up-actions";

/**
 * **Flying guidance to follow up, shop-wide, on Today** (layer E): each guest
 * whose earlier flying guidance may no longer apply, with their departure and
 * the resolve tap. Moved off the trip page, which showed every trip's list on
 * every trip; a trip's own follow-ups are on its Wrapped up. Nothing when none.
 */
export async function FlySafeFollowUps({
  db,
  shop,
  shopSlug,
  now,
  t,
}: {
  db: AppDb;
  shop: { id: string };
  shopSlug: string;
  now: Date;
  t: StaffTranslator;
}) {
  const items = await listShopFlySafeFollowUps(db, { shopId: shop.id, now });
  if (!items.length) return null;
  return (
    <section
      id="fly-safe-follow-up"
      className={`${TONE_PANEL_CLASS} scroll-mt-24 border-warning/40 bg-warning/10`}
      aria-labelledby="fly-safe-follow-up-heading"
    >
      <h2 id="fly-safe-follow-up-heading" className="font-semibold">
        {t("trips.flySafeFollowUp.heading")}
      </h2>
      <p>{t("trips.flySafeFollowUp.intro")}</p>
      <p>{t("trips.flySafeFollowUp.resolveHelp")}</p>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.bookingId}>
            {item.name}
            {" — "}
            <Link className={proseLinkClass} href={shopPath(shopSlug, "trips", item.tripId)}>
              {item.tripTitle}
            </Link>
            :{" "}
            {t(
              item.status === "queued"
                ? "trips.flySafeFollowUp.queued"
                : "trips.flySafeFollowUp.contact",
            )}
            <form
              className="mt-1"
              action={acknowledgeFlySafeAction.bind(
                null,
                shopSlug,
                item.tripId,
                item.bookingId,
                item.fingerprint,
              )}
            >
              <SubmitButton
                pendingLabel={t("words.busy.saving")}
                className={buttonClass({ variant: "secondary" })}
                ariaLabel={t("trips.flySafeFollowUp.resolveFor", { name: item.name })}
              >
                {t("trips.flySafeFollowUp.resolve")}
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
