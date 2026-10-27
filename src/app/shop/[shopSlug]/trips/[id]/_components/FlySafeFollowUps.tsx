import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import { listShopFlySafeFollowUps } from "@/db/fly-safe-correction";
import { staffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { acknowledgeFlySafeAction } from "./fly-safe-follow-up-actions";

type Locale = Parameters<typeof staffTranslator>[0];

export async function FlySafeFollowUps({
  db,
  shop,
  shopSlug,
  tripId,
  now,
  locale,
}: {
  db: AppDb;
  shop: { id: string };
  shopSlug: string;
  tripId: string;
  now: Date;
  locale: Locale;
}) {
  const items = await listShopFlySafeFollowUps(db, { shopId: shop.id, now });
  if (!items.length) return null;
  const t = staffTranslator(locale);
  return (
    <section
      className={`${TONE_PANEL_CLASS} border-warning/40 bg-warning/10`}
      aria-labelledby="fly-safe-follow-up"
    >
      <h2 id="fly-safe-follow-up" className="font-semibold">
        {t("trips.flySafeFollowUp.heading")}
      </h2>
      <p>{t("trips.flySafeFollowUp.intro")}</p>
      <p>{t("trips.flySafeFollowUp.resolveHelp")}</p>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.bookingId}>
            {item.name} —{" "}
            <Link className="underline" href={shopPath(shopSlug, "trips", item.tripId)}>
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
                tripId,
                item.bookingId,
                item.fingerprint,
              )}
            >
              <SubmitButton
                pendingLabel={t("trips.flySafeFollowUp.resolving")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
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
