import Link from "next/link";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import type { AppDb } from "@/db/client";
import { listShopFlySafeFollowUps } from "@/db/fly-safe-correction";
import { staffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

type Locale = Parameters<typeof staffTranslator>[0];

export async function FlySafeFollowUps({
  db,
  shopId,
  shopSlug,
  now,
  locale,
}: {
  db: AppDb;
  shopId: string;
  shopSlug: string;
  now: Date;
  locale: Locale;
}) {
  const items = await listShopFlySafeFollowUps(db, { shopId, now });
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
      <ul className="mt-2 list-inside list-disc">
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
          </li>
        ))}
      </ul>
    </section>
  );
}
