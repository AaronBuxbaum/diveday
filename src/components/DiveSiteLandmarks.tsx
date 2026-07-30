import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import type {
  DiveSiteLandmark,
  DiveSiteLandmarkDescription,
  DiveSiteLandmarkKind,
} from "@/lib/dive-site-landmarks";

/**
 * `buildDiveSiteLandmarks` returns codes, not prose (src/lib/dive-site-landmarks.ts) —
 * these two maps are where each one becomes a word in the diver bundle.
 */
const LANDMARK_KIND_KEYS: Record<DiveSiteLandmarkKind, DiverMessageKey> = {
  navigationMark: "site.landmarkKinds.navigationMark",
  reefHistory: "site.landmarkKinds.reefHistory",
  wreckFeature: "site.landmarkKinds.wreckFeature",
  underwaterMonument: "site.landmarkKinds.underwaterMonument",
  reefFormation: "site.landmarkKinds.reefFormation",
  pointOfInterest: "site.landmarkKinds.pointOfInterest",
};

const LANDMARK_DESCRIPTION_KEYS: Record<DiveSiteLandmarkDescription, DiverMessageKey> = {
  molassesReefLight: "site.landmarkDescriptions.molassesReefLight",
  shipsWinch: "site.landmarkDescriptions.shipsWinch",
  spanishAnchor: "site.landmarkDescriptions.spanishAnchor",
  flightDeckAndCranes: "site.landmarkDescriptions.flightDeckAndCranes",
  wellDeck: "site.landmarkDescriptions.wellDeck",
  christOfAbyssStatue: "site.landmarkDescriptions.christOfAbyssStatue",
  dryRocksSandChannels: "site.landmarkDescriptions.dryRocksSandChannels",
  generic: "site.landmarkDescriptions.generic",
};

export function DiveSiteLandmarks({
  landmarks,
  t,
}: {
  landmarks: DiveSiteLandmark[];
  t: DiverTranslator;
}) {
  if (landmarks.length === 0) return null;

  return (
    <section className="pt-2">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">
        {t("site.landmarksEyebrow")}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-xl font-semibold tracking-tight">{t("site.landmarksHeading")}</h3>
        <p className="text-sm text-muted">{t("site.landmarksNote")}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {landmarks.map((landmark, index) => (
          <article
            key={landmark.name}
            className="relative overflow-hidden rounded-xl bg-surface-sunken p-5"
          >
            <span
              aria-hidden="true"
              className="absolute top-1 right-3 text-6xl font-semibold tracking-tighter text-primary/10"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className="relative text-xs font-medium tracking-widest text-primary uppercase">
              {t(LANDMARK_KIND_KEYS[landmark.kind])}
            </p>
            <h4 className="relative mt-2 text-lg font-semibold">{landmark.name}</h4>
            <p className="relative mt-2 max-w-prose text-sm leading-relaxed text-muted">
              {t(LANDMARK_DESCRIPTION_KEYS[landmark.description])}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
