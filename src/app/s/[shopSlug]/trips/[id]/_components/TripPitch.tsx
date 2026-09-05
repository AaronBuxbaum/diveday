import { StoredPhoto } from "@/components/StoredPhoto";
import { Badge } from "@/components/ui/badge";
import { LedgerGroup } from "@/components/ui/ledger";
import type { PublicCrewMember } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { siteFit } from "@/lib/diver-planning";
import { TripCrewLine } from "./TripCrewLine";
import {
  dayMomentsFor,
  fieldGuideCardsFor,
  routeSitesFor,
  siteNotePassagesFor,
  TripLookFor,
  TripMoments,
  TripRoutes,
  TripSiteNotes,
} from "./TripDayPlan";
import type { DiveBriefing } from "./types";

/**
 * **The pitch, bounded** — ADR 20260904-reef-all-the-way-down, decision 1.
 *
 * The public departure page measured **5,782px at 390 before the form**: a
 * route map, ten species with photographs, a moments strip, five site-notes
 * paragraphs and the crew, all of it standing between a diver and the one act
 * the page exists for. The thread ADR
 * ([20260827-the-divers-thread](../../../../../../docs/architecture/decisions/20260827-the-divers-thread.md))
 * put the form last and was right; nothing bounded what came before it, and
 * this repository's own rule is that a page that screenshots enormous is
 * telling you the page is unbounded — and that the fix belongs in the product,
 * never in the capture.
 *
 * **This block has exactly three children, and that is the rule.** A fact line,
 * three field-guide tiles, and one door. `TripPitch.test.tsx` asserts the child
 * count and the tile count, so the next feature that wants to sell harder has
 * to open the door rather than add a fourth section — which is the deliberate
 * act the ADR asks for.
 *
 * **Nothing is deleted.** The five beats that used to run down the page —
 * `TripRoutes`, the rest of `TripLookFor`, `TripMoments`, `TripSiteNotes` and
 * `TripCrewLine` — are all still on this page, in this order, one tap away
 * inside the door. The door is a native `<details>` through `LedgerGroup`,
 * which is the app's one disclosure spelling precisely because "a JS failure
 * still leaves the rows one tap away" (`src/components/ui/ledger.tsx`): with
 * JavaScript off the door still opens, and every word behind it is in the DOM
 * for a screen reader and a crawler either way.
 *
 * Renders nothing at all when the day has no species, no prose, no route, no
 * published moment and no consenting crew — a bare course session gains no
 * empty frame.
 */
export function TripPitch({
  briefings,
  crew,
  locale,
}: {
  briefings: DiveBriefing[];
  /** Only the crew who said yes (`tripPublicCrew`); empty for nearly every shop. */
  crew: readonly PublicCrewMember[];
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
}) {
  const t = diverTranslator(locale);
  const cards = fieldGuideCardsFor(briefings);
  const tiles = cards.slice(0, PITCH_TILES);
  const hidden = cards.length - tiles.length;
  // The one fact this block promotes out from behind the door: how demanding
  // the day reads. Everything else on the chip line the artboard drew is
  // already printed above it — the depth range rides on each `TripDayPlan`
  // row, and the certification the trip asks for is the page's own
  // requirement note under this block.
  const fitWord = dayFitWord(briefings, t);
  // Whether the door opens onto anything, asked of the same four builders the
  // beats themselves read — never a second detector, which is how a door ends
  // up promising a reader something and costing them a tap to find out there
  // was nothing.
  const doorHasContent =
    cards.length > 0 ||
    crew.length > 0 ||
    routeSitesFor(briefings).length > 0 ||
    dayMomentsFor(briefings).length > 0 ||
    siteNotePassagesFor(briefings).length > 0;
  if (!fitWord && tiles.length === 0 && !doorHasContent) return null;
  return (
    <section className="mt-8">
      {/* 1 — the fact line. */}
      {fitWord ? (
        <p>
          <Badge tone="neutral">{fitWord}</Badge>
        </p>
      ) : null}
      {/* 2 — three faces, and no more. The photo is decorative (`alt=""`): the
          name beside it is the content, so a screen reader hears each species
          once. The full card, with the shop's field note and how to spot it,
          is behind the door. */}
      {tiles.length > 0 ? (
        <ul aria-label={t("trip.lookFor")} className="mt-3 grid grid-cols-3 gap-2">
          {tiles.map((card) => (
            <li key={card.slug ?? card.name} data-pitch-tile className="min-w-0">
              <StoredPhoto
                src={card.imageUrl}
                alt=""
                className="aspect-[4/3] w-full rounded-inset"
                // Three cells across the measure: a third of `max-w-xl`
                // (36rem) minus the gaps, and the full third of a 390px phone.
                sizes="(min-width: 640px) 11rem, 32vw"
              />
              {/* Two lines rather than a truncation: a third of a 390px phone
                  is about 110px, and "Stoplight parrotfish" read "Stoplight
                  parro…" there — a species name clipped to a stem is a tile
                  that has stopped naming anything. */}
              <p className="mt-1 line-clamp-2 text-sm leading-tight font-medium">{card.name}</p>
            </li>
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
          label={t("trip.pitchDoor")}
          meta={hidden > 0 ? t("trip.pitchDoorSpecies", { count: hidden }) : undefined}
        >
          <div data-pitch-door-body>
            <TripLookFor briefings={briefings} locale={locale} />
            <TripRoutes briefings={briefings} locale={locale} />
            <TripMoments briefings={briefings} locale={locale} />
            <TripSiteNotes briefings={briefings} locale={locale} />
            <TripCrewLine crew={crew} locale={locale} />
          </div>
        </LedgerGroup>
      ) : null}
    </section>
  );
}

/**
 * Three, and the number is the bound. The Gap board reads "no more than four
 * field-guide tiles" counting the drawing's `+ 7 more` cell; the ADR's decision
 * says three tiles and a door, and this follows the ADR — the door is a
 * full-width row beneath the grid rather than a fourth cell inside it, because
 * a native `<summary>` cannot be a grid item of a grid its own `<details>` also
 * encloses without `display: contents`, which is not safe on a disclosure
 * widget.
 */
const PITCH_TILES = 3;

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
  const seen = new Set<string>();
  let welcoming = false;
  for (const { diveSite } of briefings) {
    if (!diveSite || seen.has(diveSite.id)) continue;
    seen.add(diveSite.id);
    const { tone } = siteFit(diveSite);
    if (tone === "demanding") return t("trip.siteFitDemandingLabel");
    if (tone === "welcoming") welcoming = true;
  }
  return welcoming ? t("trip.siteFitWelcomingLabel") : null;
}
