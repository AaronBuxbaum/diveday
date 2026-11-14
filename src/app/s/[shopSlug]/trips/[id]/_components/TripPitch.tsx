import { LogEntryPreview } from "@/components/LogEntryPreview";
import {
  fieldGuideCardsFor,
  routeSitesFor,
  siteNotePassagesFor,
  TripLookFor,
  TripRoutes,
  TripSiteNotes,
} from "@/components/SiteBriefing";
import { LedgerGroup } from "@/components/ui/ledger";
import type { PublicCrewMember } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { siteFit } from "@/lib/diver-planning";
import { formatShortDate } from "@/lib/format";
import { capturePhoto } from "@/lib/marine-life-tiles";
import type { PublicStaffProfile } from "@/lib/public-staff-profile";
import type { SiteSightings } from "@/lib/sightings";
import { PublicStaffProfiles } from "../../../_components/PublicStaffProfiles";
import { TripCrewLine } from "./TripCrewLine";
import type { DiveBriefing } from "./types";
import { WildlifeTile } from "./WildlifeTile";
import { wildlifeCards } from "./wildlife-cards";

/**
 * The widest cell this strip's three faces render into, per layout.
 *
 * Both viewports, because a capture has no srcset and one file is drawn into
 * both. Measured off the captures: the ordinary page renders 171 at 1280 and
 * 109 at 390; an embed frame renders 413 and 117, its tile runs coming back
 * 413, 414, 413 and 117, 116, 117.
 */
const PAGE_TILE_PX = [109, 171] as const;
const EMBED_TILE_PX = [117, 413] as const;

/** The trip's selected field-guide species and recent sightings, followed by its details. */
export function TripPitch({
  briefings,
  crew,
  profiles = [],
  locale,
  timeZone,
  logEntry,
  embed = false,
  sightings,
}: {
  briefings: DiveBriefing[];
  sightings?: ReadonlyMap<string, SiteSightings>;
  /** Only the crew who said yes (`tripPublicCrew`); empty for nearly every shop. */
  crew: readonly PublicCrewMember[];
  profiles?: readonly PublicStaffProfile[];
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
  /** The shop's zone, for the date on the log entry's miniature. */
  timeZone: string;
  /**
   * **Where the day ends up** (UX review 2026-10-10, item 35): the recap's log
   * entry, which a booked diver's link turns into once the boat is home. One
   * line and a miniature at the end of the door's body, so the page's bound
   * above the form is unchanged (ADR 20260904-reef-all-the-way-down,
   * decision 1; moved here from `TripDayPlan` by issue #2430). Absent on a day
   * that has already sailed.
   */
  logEntry?: { startsAt: Date; isCourse: boolean };
  /**
   * Whether the page is rendering inside an embed frame, where the whole column
   * is `w-full` rather than `max-w-xl` — so a third of it is 413px at 1280
   * rather than the 171px the ordinary page renders. It changes what this strip
   * asks the browser for, and nothing about what it draws.
   */
  embed?: boolean;
}) {
  const t = diverTranslator(locale);
  const cards = fieldGuideCardsFor(briefings);
  const tiles = wildlifeCards(briefings, sightings, t);
  // The one fact this block promotes out from behind the door: how demanding
  // the day reads. Everything else on the chip line the artboard drew is
  // already printed above it — the depth range rides on each `TripDayPlan`
  // row, and the certification the trip asks for is the page's own
  // requirement note under this block.
  const fitWord = dayFitWord(briefings, t);
  const doorHasContent = profiles.length > 0 || pitchHasDoor(briefings, crew, Boolean(logEntry));
  if (!fitWord && tiles.length === 0 && !doorHasContent) return null;
  return (
    <section>
      {/* 1 — the fact line. */}
      {/* A plain line, never a chip (visual review 2026-10-24, B41), and
          only for the day that asks something of a diver: "Welcoming dive"
          stood alone over the faces and said nothing a reader acts on. Each
          site keeps its own word behind the door. */}
      {fitWord ? <p className="text-sm font-medium">{fitWord}</p> : null}
      {/* Selected species lead; recent sightings fill up to three additional tiles. */}
      {tiles.length > 0 ? (
        <ul aria-label={t("trip.lookFor")} className="mt-3 grid grid-cols-3 gap-2">
          {tiles.map(({ card, seen }, index) => (
            <WildlifeTile
              key={card.slug}
              card={card}
              seen={seen}
              alignEnd={index % 3 !== 0}
              seenLabel={t("trip.seen.cardLabel")}
              photo={capturePhoto(card.imageUrl, embed ? EMBED_TILE_PX : PAGE_TILE_PX)}
              sizes={embed ? "32vw" : "(min-width: 640px) 11rem, 32vw"}
            />
          ))}
        </ul>
      ) : null}
      {/* 3 — the door, and the whole of what this block bounds. */}
      {doorHasContent ? (
        <LedgerGroup
          className="mt-4"
          as="h2"
          folded
          summaryVariant="row"
          // The diver pages' one disclosure face: the chevron that turns
          // open, as the course FAQ, the schedule's filters and "Other ways
          // we can help" wear (visual review 2026-10-24, B35).
          caret="down"
          label={t("trip.pitchDoor")}
          // What the door *holds*, not what the grid skipped. The artboard's
          // "+ 7 more" was a fourth cell in the tile row, counting faces it had
          // no room for; moving it onto the door turned it into a claim about
          // what is behind the door, and the door carries the whole field guide.
          // Each card there is the photo plus the shop's own note and how to
          // spot it, which is exactly what a tile cannot show, so the three
          // promoted faces belong inside it too rather than losing their prose.
          meta={cards.length > 0 ? t("trip.pitchDoorSpecies", { count: cards.length }) : undefined}
        >
          {/* `pb-6`: open, the body keeps 24px above the conditions line,
              which sits flush under this door (`pitchHasDoor`). */}
          <div data-pitch-door-body className="pb-6">
            <TripLookFor briefings={briefings} locale={locale} />
            <TripRoutes briefings={briefings} locale={locale} />
            <TripSiteNotes briefings={briefings} locale={locale} />
            <TripCrewLine crew={crew} locale={locale} className="mt-6" />
            <PublicStaffProfiles profiles={profiles} locale={locale} />
            {logEntry ? (
              <div className={pitchHasDoor(briefings, crew) ? "mt-6" : undefined}>
                <LogEntryPreview
                  line={t("trip.logEntryWaiting")}
                  date={formatShortDate(logEntry.startsAt, locale, timeZone)}
                  siteNames={[
                    ...new Set(
                      briefings
                        .map(({ diveSite }) => diveSite?.name)
                        .filter((name): name is string => Boolean(name)),
                    ),
                  ]}
                  isCourse={logEntry.isCourse}
                  t={t}
                />
              </div>
            ) : null}
          </div>
        </LedgerGroup>
      ) : null}
    </section>
  );
}

/**
 * Whether the pitch ends in its door: asked of the same builders the beats
 * behind it read — never a second detector, which is how a door ends up
 * promising a reader something and costing them a tap to find out there was
 * nothing. The page asks it too, to sit the conditions line flush under the
 * door so its rule is the door's close (pixel-craft class 6).
 */
export function pitchHasDoor(
  briefings: DiveBriefing[],
  crew: readonly PublicCrewMember[],
  hasLogEntry = false,
): boolean {
  return (
    (hasLogEntry && briefings.length > 0) ||
    fieldGuideCardsFor(briefings).length > 0 ||
    crew.length > 0 ||
    routeSitesFor(briefings).length > 0 ||
    siteNotePassagesFor(briefings).length > 0
  );
}

/**
 * Whether the pitch *opens* on its door: a door, and no fit word or faces
 * above it — so the first thing it draws is the door's rule. Only then may the
 * day's run above leave its close to it (`TripDayPlan`'s `nextOpensOnRule`);
 * over the fit word's badge or the faces, the run's own rule is the only
 * close it has (pixel-craft class 6). Asked of the builders the block renders
 * from, never a second detector.
 */
export function pitchOpensOnDoor(
  briefings: DiveBriefing[],
  crew: readonly PublicCrewMember[],
  hasLogEntry = false,
): boolean {
  return (
    pitchHasDoor(briefings, crew, hasLogEntry) &&
    dayFitTone(briefings) !== "demanding" &&
    fieldGuideCardsFor(briefings).length === 0
  );
}

/**
 * How demanding the day reads, in one word, or null when the shop has said
 * nothing that supports one.
 *
 * The most demanding reading across the day's sites wins: a two-tank day whose
 * second tank is the drift is a day that wants recent experience, and averaging
 * that away would be the page softening a fact the shop stated. `siteFit`
 * returns a tone and `trip.siteFit*Label` is where it becomes a word.
 */
function dayFitWord(
  briefings: readonly DiveBriefing[],
  t: ReturnType<typeof diverTranslator>,
): string | null {
  return dayFitTone(briefings) === "demanding" ? t("trip.siteFitDemandingLabel") : null;
}

/** The tone `dayFitWord` says in a word — whether there is one to say needs no translator. */
function dayFitTone(briefings: readonly DiveBriefing[]): "demanding" | "welcoming" | null {
  const seen = new Set<string>();
  let welcoming = false;
  for (const { diveSite } of briefings) {
    if (!diveSite || seen.has(diveSite.id)) continue;
    seen.add(diveSite.id);
    const { tone } = siteFit(diveSite);
    if (tone === "demanding") return "demanding";
    if (tone === "welcoming") welcoming = true;
  }
  return welcoming ? "welcoming" : null;
}
