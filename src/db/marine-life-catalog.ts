/**
 * DiveDay's marine-life catalog: which species a shop can put on a dive site's
 * field guide.
 *
 * **This file holds no words.** A species is a slug, a Latin binomial and a
 * category code; its common name, its description and its "how to actually see
 * one" tip live in `marineLife.species.<slug>` in every locale's diver bundle
 * and are resolved through `src/i18n/marine-life-labels.ts` at render time. So
 * a Spanish-reading diver gets a Spanish field guide off the same row an
 * English-reading one reads in English (ADR
 * 20260813-marine-life-is-diveday-copy).
 *
 * That is the opposite of `./course-templates.ts` and `./dive-site-templates.ts`
 * next door, which are still copy-at-pick-time starter text a shop rewrites in
 * its own voice, and it is deliberate: a shop's dive plan for Molasses Reef is
 * the shop's to write, and what a stoplight parrotfish looks like is not. A
 * shop chooses *which* faces its briefing shows and in what order; DiveDay
 * writes them, in both languages, once.
 *
 * **Scope: the tropical western Atlantic** -- Florida, the Keys, the Bahamas
 * and the wider Caribbean, which is where DiveDay's own dive-site templates
 * are. Every entry is a species a recreational diver plausibly meets on one of
 * those dives.
 *
 * **Photos** are bundled under `public/marine-life/` rather than hot-linked,
 * for the reason every other image in this app is (CR-020): a briefing page
 * must never make a live request to a host someone else controls. Credits and
 * licences are in that folder's README.
 *
 * **Removing a species is a breaking change** and adding one is not. A slug in
 * this list is a foreign key from `dive_site_creatures.catalog_slug` and a key
 * into every locale's bundle; drop one and a shop's saved briefing quietly
 * loses a card. `marine-life-catalog.test.ts` pins the two halves together, so
 * a species added here without copy fails rather than renders a slug.
 */

/** The category word printed over a species' name, as a code the bundle names. */
export const MARINE_LIFE_KINDS = [
  "reefFish",
  "schoolingFish",
  "predator",
  "shark",
  "ray",
  "eel",
  "camouflage",
  "invasive",
  "marineMammal",
  "turtle",
  "crustacean",
  "mollusc",
  "reefInvertebrate",
  "drifter",
  "sponge",
  "softCoral",
  "hardCoral",
  "seagrass",
] as const;

export type MarineLifeKind = (typeof MARINE_LIFE_KINDS)[number];

export type MarineLifeSpecies = {
  /** Stable id: the `dive_site_creatures.catalog_slug` value and the bundle key. */
  slug: string;
  /**
   * The species' formal name, for the shop that wants to be exact. The one
   * string here that is not in the bundles, because a Latin binomial is the
   * same in every language -- translating it would mean maintaining two copies
   * of a name that has exactly one correct form.
   */
  scientificName: string;
  kind: MarineLifeKind;
};

/** Where the bundled photo for a catalog species lives. */
export function marineLifeImage(slug: string): string {
  return `/marine-life/${slug}.jpg`;
}

/**
 * Every species, in the order the picker offers them: grouped by what a diver
 * would call them, and alphabetical inside each group. Not alphabetical
 * overall -- a staffer writing a reef briefing thinks "what fish, then what
 * else", and 93 names in one A-Z is a list nobody reads to the end of.
 */
export const MARINE_LIFE_CATALOG = [
  // --- Reef fish ------------------------------------------------------------
  { slug: "banded-butterflyfish", scientificName: "Chaetodon striatus", kind: "reefFish" },
  { slug: "blue-chromis", scientificName: "Chromis cyanea", kind: "reefFish" },
  { slug: "blue-tang", scientificName: "Acanthurus coeruleus", kind: "reefFish" },
  { slug: "bluehead-wrasse", scientificName: "Thalassoma bifasciatum", kind: "reefFish" },
  { slug: "bluestriped-grunt", scientificName: "Haemulon sciurus", kind: "schoolingFish" },
  { slug: "creole-wrasse", scientificName: "Clepticus parrae", kind: "schoolingFish" },
  { slug: "foureye-butterflyfish", scientificName: "Chaetodon capistratus", kind: "reefFish" },
  { slug: "french-angelfish", scientificName: "Pomacanthus paru", kind: "reefFish" },
  { slug: "french-grunt", scientificName: "Haemulon flavolineatum", kind: "schoolingFish" },
  { slug: "gray-angelfish", scientificName: "Pomacanthus arcuatus", kind: "reefFish" },
  { slug: "honeycomb-cowfish", scientificName: "Acanthostracion polygonius", kind: "reefFish" },
  { slug: "porkfish", scientificName: "Anisotremus virginicus", kind: "schoolingFish" },
  { slug: "queen-angelfish", scientificName: "Holacanthus ciliaris", kind: "reefFish" },
  { slug: "queen-parrotfish", scientificName: "Scarus vetula", kind: "reefFish" },
  { slug: "rock-beauty", scientificName: "Holacanthus tricolor", kind: "reefFish" },
  { slug: "sergeant-major", scientificName: "Abudefduf saxatilis", kind: "reefFish" },
  { slug: "spotfin-butterflyfish", scientificName: "Chaetodon ocellatus", kind: "reefFish" },
  { slug: "spotted-drum", scientificName: "Equetus punctatus", kind: "reefFish" },
  { slug: "stoplight-parrotfish", scientificName: "Sparisoma viride", kind: "reefFish" },
  { slug: "trumpetfish", scientificName: "Aulostomus maculatus", kind: "reefFish" },
  { slug: "white-grunt", scientificName: "Haemulon plumierii", kind: "schoolingFish" },
  { slug: "yellowhead-jawfish", scientificName: "Opistognathus aurifrons", kind: "reefFish" },
  // --- Bigger fish ----------------------------------------------------------
  { slug: "bar-jack", scientificName: "Caranx ruber", kind: "predator" },
  { slug: "black-grouper", scientificName: "Mycteroperca bonaci", kind: "predator" },
  { slug: "cobia", scientificName: "Rachycentron canadum", kind: "predator" },
  { slug: "goliath-grouper", scientificName: "Epinephelus itajara", kind: "predator" },
  { slug: "gray-snapper", scientificName: "Lutjanus griseus", kind: "schoolingFish" },
  { slug: "great-barracuda", scientificName: "Sphyraena barracuda", kind: "predator" },
  { slug: "horse-eye-jack", scientificName: "Caranx latus", kind: "schoolingFish" },
  { slug: "hogfish", scientificName: "Lachnolaimus maximus", kind: "reefFish" },
  { slug: "nassau-grouper", scientificName: "Epinephelus striatus", kind: "predator" },
  { slug: "permit-fish", scientificName: "Trachinotus falcatus", kind: "predator" },
  { slug: "red-grouper", scientificName: "Epinephelus morio", kind: "predator" },
  { slug: "remora", scientificName: "Echeneis naucrates", kind: "reefFish" },
  { slug: "schoolmaster-snapper", scientificName: "Lutjanus apodus", kind: "schoolingFish" },
  { slug: "tarpon", scientificName: "Megalops atlanticus", kind: "predator" },
  { slug: "yellowtail-snapper", scientificName: "Ocyurus chrysurus", kind: "schoolingFish" },
  // --- Sharks and rays ------------------------------------------------------
  { slug: "caribbean-reef-shark", scientificName: "Carcharhinus perezi", kind: "shark" },
  { slug: "lemon-shark", scientificName: "Negaprion brevirostris", kind: "shark" },
  { slug: "nurse-shark", scientificName: "Ginglymostoma cirratum", kind: "shark" },
  { slug: "southern-stingray", scientificName: "Hypanus americanus", kind: "ray" },
  { slug: "spotted-eagle-ray", scientificName: "Aetobatus narinari", kind: "ray" },
  { slug: "yellow-stingray", scientificName: "Urobatis jamaicensis", kind: "ray" },
  // --- Eels and ambush hunters ----------------------------------------------
  { slug: "goldentail-moray", scientificName: "Gymnothorax miliaris", kind: "eel" },
  { slug: "green-moray", scientificName: "Gymnothorax funebris", kind: "eel" },
  { slug: "spotted-moray", scientificName: "Gymnothorax moringa", kind: "eel" },
  { slug: "peacock-flounder", scientificName: "Bothus lunatus", kind: "camouflage" },
  { slug: "sand-diver", scientificName: "Synodus intermedius", kind: "camouflage" },
  { slug: "spotted-scorpionfish", scientificName: "Scorpaena plumieri", kind: "camouflage" },
  { slug: "lionfish", scientificName: "Pterois volitans", kind: "invasive" },
  // --- Reef oddities --------------------------------------------------------
  { slug: "blackbar-soldierfish", scientificName: "Myripristis jacobus", kind: "reefFish" },
  { slug: "glassy-sweeper", scientificName: "Pempheris schomburgkii", kind: "schoolingFish" },
  { slug: "porcupinefish", scientificName: "Diodon hystrix", kind: "reefFish" },
  { slug: "queen-triggerfish", scientificName: "Balistes vetula", kind: "reefFish" },
  { slug: "scrawled-filefish", scientificName: "Aluterus scriptus", kind: "reefFish" },
  { slug: "smooth-trunkfish", scientificName: "Lactophrys triqueter", kind: "reefFish" },
  { slug: "spanish-hogfish", scientificName: "Bodianus rufus", kind: "reefFish" },
  { slug: "squirrelfish", scientificName: "Holocentrus adscensionis", kind: "reefFish" },
  // --- Turtles and mammals --------------------------------------------------
  { slug: "bottlenose-dolphin", scientificName: "Tursiops truncatus", kind: "marineMammal" },
  { slug: "green-sea-turtle", scientificName: "Chelonia mydas", kind: "turtle" },
  { slug: "hawksbill-turtle", scientificName: "Eretmochelys imbricata", kind: "turtle" },
  { slug: "loggerhead-turtle", scientificName: "Caretta caretta", kind: "turtle" },
  { slug: "manatee", scientificName: "Trichechus manatus", kind: "marineMammal" },
  // --- Invertebrates --------------------------------------------------------
  { slug: "arrow-crab", scientificName: "Stenorhynchus seticornis", kind: "crustacean" },
  { slug: "banded-coral-shrimp", scientificName: "Stenopus hispidus", kind: "crustacean" },
  { slug: "caribbean-reef-octopus", scientificName: "Octopus briareus", kind: "mollusc" },
  { slug: "caribbean-reef-squid", scientificName: "Sepioteuthis sepioidea", kind: "mollusc" },
  { slug: "channel-clinging-crab", scientificName: "Mithrax spinosissimus", kind: "crustacean" },
  {
    slug: "christmas-tree-worm",
    scientificName: "Spirobranchus giganteus",
    kind: "reefInvertebrate",
  },
  { slug: "cushion-sea-star", scientificName: "Oreaster reticulatus", kind: "reefInvertebrate" },
  {
    slug: "feather-duster-worm",
    scientificName: "Sabellastarte magnifica",
    kind: "reefInvertebrate",
  },
  { slug: "flamingo-tongue", scientificName: "Cyphoma gibbosum", kind: "mollusc" },
  { slug: "giant-anemone", scientificName: "Condylactis gigantea", kind: "reefInvertebrate" },
  { slug: "long-spined-urchin", scientificName: "Diadema antillarum", kind: "reefInvertebrate" },
  { slug: "moon-jelly", scientificName: "Aurelia aurita", kind: "drifter" },
  { slug: "pederson-cleaner-shrimp", scientificName: "Ancylomenes pedersoni", kind: "crustacean" },
  { slug: "queen-conch", scientificName: "Lobatus gigas", kind: "mollusc" },
  { slug: "spiny-lobster", scientificName: "Panulirus argus", kind: "crustacean" },
  { slug: "upside-down-jellyfish", scientificName: "Cassiopea xamachana", kind: "drifter" },
  // --- Corals, sponges and the reef itself ----------------------------------
  { slug: "azure-vase-sponge", scientificName: "Callyspongia plicifera", kind: "sponge" },
  { slug: "common-sea-fan", scientificName: "Gorgonia ventalina", kind: "softCoral" },
  { slug: "elkhorn-coral", scientificName: "Acropora palmata", kind: "hardCoral" },
  { slug: "fire-coral", scientificName: "Millepora alcicornis", kind: "hardCoral" },
  { slug: "giant-barrel-sponge", scientificName: "Xestospongia muta", kind: "sponge" },
  { slug: "great-star-coral", scientificName: "Montastraea cavernosa", kind: "hardCoral" },
  { slug: "grooved-brain-coral", scientificName: "Diploria labyrinthiformis", kind: "hardCoral" },
  { slug: "pillar-coral", scientificName: "Dendrogyra cylindrus", kind: "hardCoral" },
  { slug: "red-rope-sponge", scientificName: "Amphimedon compressa", kind: "sponge" },
  { slug: "sea-plume", scientificName: "Pseudopterogorgia species", kind: "softCoral" },
  { slug: "staghorn-coral", scientificName: "Acropora cervicornis", kind: "hardCoral" },
  { slug: "symmetrical-brain-coral", scientificName: "Pseudodiploria strigosa", kind: "hardCoral" },
  { slug: "turtle-grass", scientificName: "Thalassia testudinum", kind: "seagrass" },
  { slug: "yellow-tube-sponge", scientificName: "Aplysina fistularis", kind: "sponge" },
] as const satisfies readonly MarineLifeSpecies[];

/**
 * Every slug the catalog carries, as a type.
 *
 * This is what makes the bundle keys checkable: `src/i18n/marine-life-labels.ts`
 * builds `marineLife.species.${MarineLifeSlug}.name`, and next-intl types every
 * key against the English bundle -- so a species added here without its three
 * strings in both locales is a compile error rather than a slug rendered on a
 * diver's screen.
 */
export type MarineLifeSlug = (typeof MARINE_LIFE_CATALOG)[number]["slug"];

/** Every catalog entry, keyed by slug -- the picker's own lookup. */
export const MARINE_LIFE_BY_SLUG = new Map(
  MARINE_LIFE_CATALOG.map((species) => [species.slug, species]),
);

/**
 * Whether a slug names a species DiveDay still carries.
 *
 * The narrowing boundary for everything read back out of the database: a
 * `catalog_slug` column is `text`, and a row written by an older release can
 * name a species this list no longer has. Past this predicate the slug is one
 * the bundles are known to have words for.
 */
export function isMarineLifeSlug(slug: string): slug is MarineLifeSlug {
  return MARINE_LIFE_BY_SLUG.has(slug as MarineLifeSlug);
}
