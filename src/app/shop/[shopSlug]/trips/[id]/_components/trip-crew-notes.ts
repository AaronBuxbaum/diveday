import type { getTripOverview } from "@/db/trips";
import { overRatioWarningText } from "@/i18n/crew-gap-labels";
import { languageNameIn } from "@/i18n/language-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ratingLapsedDetailText, ratingUnverifiedDetailText } from "@/i18n/today-labels";
import { cachedListFormat } from "@/lib/intl-cache";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.

type TripOverview = NonNullable<Awaited<ReturnType<typeof getTripOverview>>>;

/** Past this many divers in one language, the note counts them instead of naming them. */
const LANGUAGE_NOTE_NAMES = 3;

/** "This hull is on another departure at these hours" — the pulse's door and the crew row's line. */
export function boatClashText(t: StaffTranslator, clash: TripOverview["boatClashes"][number]) {
  return t("trips.pulse.boatClash", { boat: clash.boatName, departure: clash.otherTitle });
}

/**
 * The crew panel's four advisory sentences, each null when it has nothing to
 * say: a lapsed rating, a language nobody aboard speaks, a shortfall against
 * the shop's own diver:divemaster target, and the agency's student ratio.
 */
export function tripCrewNotes({
  crew,
  diversPerDivemaster,
  locale,
  t,
}: {
  crew: TripOverview["crew"];
  diversPerDivemaster: number;
  locale: string;
  t: StaffTranslator;
}) {
  const { crewGap, ratioGap, lapsedCrew, unverifiedCrew } = crew;
  // Who a lapsed rating took down a rung (issue #1853), in Today's own
  // sentence: one fact, one set of words wherever a staffer meets it.
  const ratingLapsedNote =
    [
      lapsedCrew.length > 0 ? ratingLapsedDetailText(t, locale, lapsedCrew) : null,
      unverifiedCrew?.length ? ratingUnverifiedDetailText(t, locale, unverifiedCrew) : null,
    ]
      .filter(Boolean)
      .join(" ") || null;
  // Same tone as underTargetNote below: informs, refuses nothing (issue
  // #708). Each language is named in the reader's own locale
  // (`languageNameIn`), matching the team settings form's convention. The
  // divers are named, and so is who on the crew can brief them (fifth-loop
  // ideas, item 48): a missing language first, then each covered one.
  const list = (names: readonly string[]) =>
    cachedListFormat(locale, { style: "long", type: "conjunction" }).format(names);
  const languageName = (code: string) => languageNameIn(code, locale) ?? code;
  const diversWords = (divers: readonly string[]) =>
    divers.length > LANGUAGE_NOTE_NAMES
      ? t("trips.crew.languageDivers", { count: divers.length })
      : list(divers);
  const languageSentences = [
    ...crew.languageBriefings.uncovered.map((briefing) =>
      t("trips.crew.languageGap", {
        divers: diversWords(briefing.divers),
        language: languageName(briefing.language),
      }),
    ),
    ...crew.languageBriefings.covered.map((briefing) =>
      t("trips.crew.languageCovered", {
        crew: list(briefing.crew),
        divers: diversWords(briefing.divers),
        language: languageName(briefing.language),
      }),
    ),
  ];
  const languageGapNote = languageSentences.length > 0 ? languageSentences.join(" ") : null;
  const underTargetNote =
    ratioGap.code === "none"
      ? null
      : t("trips.crew.underTarget", {
          divers: ratioGap.divers,
          divemasters: ratioGap.divemasterCount,
          ratio: diversPerDivemaster,
          // The total the target wants, not the shortfall: "wants 1 more" than
          // none reads as arithmetic about nothing when the boat has no
          // divemaster at all, which is the case that matters most.
          needed: ratioGap.needed,
        });
  const overRatioWarning = overRatioWarningText(t, crewGap);
  return { ratingLapsedNote, languageGapNote, underTargetNote, overRatioWarning };
}
