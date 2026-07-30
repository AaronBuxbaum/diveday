import { DiveBriefingCard } from "@/components/DiveBriefingCard";
import { diverTranslator } from "@/i18n/messages";
import type { DiveBriefing, Trip } from "./types";

export function DiveBriefingsSection({
  briefings,
  trip,
  locale,
}: {
  briefings: DiveBriefing[];
  trip: Trip;
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
}) {
  if (briefings.length === 0) return null;
  const t = diverTranslator(locale);
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">
            {t("trip.briefingsEyebrow")}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {trip.plannedDives === 2
              ? t("trip.planTwoTank")
              : t("trip.planDiveCount", { count: trip.plannedDives })}
          </h2>
        </div>
        {briefings.length > 1 ? (
          <p className="text-sm font-medium text-muted sm:hidden">{t("trip.swipeHint")}</p>
        ) : null}
      </div>
      {briefings.filter(({ diveSite }) => diveSite).length > 1 ? (
        <details className="mt-5 rounded-xl border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">
            {t("trip.compareSites")}
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-lg text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2">{t("trip.columnSite")}</th>
                  <th className="p-2">{t("trip.columnDepth")}</th>
                  <th className="p-2">{t("trip.columnExperience")}</th>
                  <th className="p-2">{t("trip.columnWaterMovement")}</th>
                  <th className="p-2">{t("trip.columnLikelyLife")}</th>
                </tr>
              </thead>
              <tbody>
                {briefings
                  .filter(({ diveSite }) => diveSite)
                  .map(({ dive, diveSite }) => (
                    <tr key={dive.id} className="border-b border-border/60">
                      <th className="p-2 font-semibold">{diveSite?.name}</th>
                      <td className="p-2 text-muted">
                        {diveSite?.depthRange ?? t("common.varies")}
                      </td>
                      <td className="p-2 text-muted">
                        {diveSite?.difficulty ?? t("common.crewLed")}
                      </td>
                      <td className="p-2 text-muted">
                        {diveSite?.currentNote ?? t("common.confirmedAtDock")}
                      </td>
                      <td className="p-2 text-muted">
                        {diveSite?.marineLife ??
                          diveSite?.marineLifeDescription ??
                          t("common.askTheCrew")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">{t("trip.compareNote")}</p>
        </details>
      ) : null}
      {/* Dives stack in one column on larger screens: a two-tank day often
          pairs one richly-briefed site with a sparse second tank, and a
          multi-column grid would strand a tall card beside a near-empty one.
          Full-width cards size to their own content, so there is no blank box. */}
      <div className="-mx-6 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-3 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-1 sm:overflow-visible sm:px-0">
        {briefings.map(({ dive, diveSite, creatures, moments }) => (
          <DiveBriefingCard
            key={dive.id}
            diveNumber={dive.diveNumber}
            title={dive.title}
            description={dive.description}
            site={diveSite}
            creatures={creatures}
            moments={moments}
            locale={locale}
          />
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">{t("trip.briefingsFooter")}</p>
    </section>
  );
}
