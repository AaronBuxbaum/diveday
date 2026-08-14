import { DiveBriefingCard } from "@/components/DiveBriefingCard";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
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
  const sited = briefings.filter(({ diveSite }) => diveSite);
  // Comparing a site against itself is a table of identical rows. A two-tank
  // day that stays on one mooring is the common case, so the whole block is
  // only worth its space once the dives are at *different* places.
  const comparableSites = new Set(sited.map(({ diveSite }) => diveSite?.id)).size > 1;
  return (
    // `mt-12` matches the forecast and packing sections — the page's
    // supporting reading shares one vertical rhythm.
    <section className="mt-12">
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
      {comparableSites ? (
        <details className="mt-5 rounded-xl border border-border bg-surface p-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            {t("trip.compareSites")}
          </summary>
          {/* The shared table vocabulary, not a public dialect of its own: a
              diver reading this is reading a table, and one header voice
              across the product reads considered rather than clerical. It is
              `flush` because the `<details>` above is already the card, and
              its own scroll shell replaces the wrapper this block used to
              hand-roll. `36rem` rather than the old `min-w-lg`: the
              vocabulary's cell padding is roomier than the `p-2` here before,
              so five prose columns need a slightly higher floor before the
              shell starts scrolling. */}
          <Table flush minWidth="36rem" shellClassName="mt-3">
            <THead>
              <Th>{t("trip.columnSite")}</Th>
              <Th>{t("trip.columnDepth")}</Th>
              <Th>{t("trip.columnExperience")}</Th>
              <Th>{t("trip.columnWaterMovement")}</Th>
              <Th>{t("trip.columnLikelyLife")}</Th>
            </THead>
            <TBody>
              {sited.map(({ dive, diveSite }) => (
                <tr key={dive.id}>
                  {/* The site names its row; every cell after it is a fact
                      about that site, so it stays a `th`. */}
                  <Th scope="row">{diveSite?.name}</Th>
                  <Td muted>{diveSite?.depthRange ?? t("common.varies")}</Td>
                  <Td muted>
                    {diveSiteDifficultyLabel(diveSite?.difficultyLevel, t) ?? t("common.crewLed")}
                  </Td>
                  <Td muted>{diveSite?.currentNote ?? t("common.confirmedAtDock")}</Td>
                  <Td muted>
                    {diveSite?.marineLife ??
                      diveSite?.marineLifeDescription ??
                      t("common.askTheCrew")}
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          <p className="mt-3 text-xs text-muted">{t("trip.compareNote")}</p>
        </details>
      ) : null}
      {/* Directly above the cards it describes, not up in the section header:
          from there it sat above the compare block and read as an instruction
          for *that*, which is a table you scroll, not a deck you swipe. */}
      {briefings.length > 1 ? (
        <p className="mt-5 text-sm font-medium text-muted sm:hidden">{t("trip.swipeHint")}</p>
      ) : null}
      {/* Dives stack in one column on larger screens: a two-tank day often
          pairs one richly-briefed site with a sparse second tank, and a
          multi-column grid would strand a tall card beside a near-empty one.
          Full-width cards size to their own content, so there is no blank box. */}
      <div className="-mx-6 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-3 sm:mx-0 sm:mt-5 sm:grid sm:snap-none sm:grid-cols-1 sm:overflow-visible sm:px-0">
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
