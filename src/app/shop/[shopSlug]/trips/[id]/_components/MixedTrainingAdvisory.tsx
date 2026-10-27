import Link from "next/link";
import { getDb } from "@/db/client";
import { mixedTrainingAdvisories } from "@/db/mixed-training-advisory";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatPlannedDateTimeTz } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

export async function MixedTrainingForTrip({
  shopId,
  tripId,
  ...display
}: {
  shopId: string;
  tripId: string;
  shopSlug: string;
  locale: string;
  timeZone: string;
}) {
  const db = await getDb();
  return (
    <MixedTrainingAdvisory sessions={mixedTrainingAdvisories(db, shopId, tripId)} {...display} />
  );
}

/** The overlap is a prompt to check the actual groups, never a readiness decision. */
export async function MixedTrainingAdvisory({
  sessions,
  shopSlug,
  locale,
  timeZone,
}: {
  sessions: ReturnType<typeof mixedTrainingAdvisories>;
  shopSlug: string;
  locale: string;
  timeZone: string;
}) {
  const matches = await sessions;
  if (matches.length === 0) return null;
  const t = staffTranslator(locale);
  return (
    <div className="rounded-inset border border-warning/25 bg-warning/10 p-4 text-sm">
      <p className="font-semibold">{t("trips.addDiver.mixedTrainingTitle")}</p>
      <p className="mt-1">{t("trips.addDiver.mixedTrainingBody")}</p>
      <ul className="mt-2 space-y-1">
        {matches.map((session) => (
          <li key={session.tripId}>
            <Link className="underline" href={shopPath(shopSlug, "trips", session.tripId)}>
              {session.title}
            </Link>
            {" · "}
            {formatPlannedDateTimeTz(session.startsAt, locale, timeZone)}
          </li>
        ))}
      </ul>
    </div>
  );
}
