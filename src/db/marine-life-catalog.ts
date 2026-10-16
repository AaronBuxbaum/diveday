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
 * That is the opposite of `src/content/course-templates.ts` and `src/content/dive-site-templates.ts`
 * next door, which are still copy-at-pick-time starter text a shop rewrites in
 * its own voice, and it is deliberate: a shop's dive plan for Molasses Reef is
 * the shop's to write, and what a stoplight parrotfish looks like is not. A
 * shop chooses *which* faces its briefing shows and in what order; DiveDay
 * writes them, in both languages, once.
 *
 * **Scope: the wider Caribbean** -- Florida, the Keys and the Bahamas, plus the
 * reefs a shop in Cozumel, Bonaire, Roatán, Cayman or the ABCs works. The first
 * 93 entries were Florida-shaped, which is where DiveDay's own site templates
 * are; the 2026-08-13 expansion added the species those other markets meet and
 * Florida rarely does -- the Cozumel-endemic splendid toadfish, the hamlets,
 * the frogfish and seahorses a Bonaire guide builds a dive around, the
 * Mesoamerican parrotfish and groupers, and the corals and sponges that make up
 * a wall anywhere south of the Keys. The 2026-10-14 expansion added every fish
 * REEF's volunteer surveys sight on one dive in ten somewhere in Florida or the
 * Caribbean, and the corals, sponges and invertebrates divers there photograph
 * most; `src/content/species-coverage.json` is the list it is measured against.
 * Every entry is a species a recreational diver plausibly meets. Outside that water the picker refuses, and the refusal
 * writes a `marine_life_requests` row rather than a dead end.
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
 * else", and over 300 names in one A-Z is a list nobody reads to the end of.
 */
export const MARINE_LIFE_CATALOG = [
  // --- Reef fish ------------------------------------------------------------
  { slug: "arrow-blenny", scientificName: "Lucayablennius zingaro", kind: "reefFish" },
  { slug: "banded-butterflyfish", scientificName: "Chaetodon striatus", kind: "reefFish" },
  { slug: "barred-cardinalfish", scientificName: "Apogon binotatus", kind: "reefFish" },
  { slug: "barred-hamlet", scientificName: "Hypoplectrus puella", kind: "reefFish" },
  { slug: "beaugregory", scientificName: "Stegastes leucostictus", kind: "reefFish" },
  { slug: "belted-cardinalfish", scientificName: "Apogon townsendi", kind: "reefFish" },
  { slug: "belted-sandfish", scientificName: "Serranus subligarius", kind: "reefFish" },
  { slug: "bicolor-damselfish", scientificName: "Stegastes partitus", kind: "reefFish" },
  { slug: "black-hamlet", scientificName: "Hypoplectrus nigricans", kind: "reefFish" },
  { slug: "black-margate", scientificName: "Anisotremus surinamensis", kind: "reefFish" },
  { slug: "blackcap-basslet", scientificName: "Gramma melacara", kind: "reefFish" },
  { slug: "blue-angelfish", scientificName: "Holacanthus bermudensis", kind: "reefFish" },
  { slug: "blue-chromis", scientificName: "Azurina cyanea", kind: "reefFish" },
  { slug: "blue-dartfish", scientificName: "Ptereleotris calliura", kind: "reefFish" },
  { slug: "blue-parrotfish", scientificName: "Scarus coeruleus", kind: "reefFish" },
  { slug: "blue-tang", scientificName: "Acanthurus coeruleus", kind: "reefFish" },
  { slug: "bluehead-wrasse", scientificName: "Thalassoma bifasciatum", kind: "reefFish" },
  { slug: "bluelip-parrotfish", scientificName: "Cryptotomus roseus", kind: "reefFish" },
  { slug: "bluestriped-grunt", scientificName: "Haemulon sciurus", kind: "schoolingFish" },
  { slug: "broadstripe-goby", scientificName: "Elacatinus prochilos", kind: "reefFish" },
  { slug: "brown-chromis", scientificName: "Azurina multilineata", kind: "reefFish" },
  { slug: "butter-hamlet", scientificName: "Hypoplectrus unicolor", kind: "reefFish" },
  { slug: "caribbean-neon-goby", scientificName: "Elacatinus lobeli", kind: "reefFish" },
  { slug: "cayman-cleaning-goby", scientificName: "Elacatinus cayman", kind: "reefFish" },
  { slug: "cayman-sponge-goby", scientificName: "Elacatinus centralis", kind: "reefFish" },
  { slug: "chalk-bass", scientificName: "Serranus tortugarum", kind: "reefFish" },
  { slug: "cherubfish", scientificName: "Centropyge argi", kind: "reefFish" },
  { slug: "cleaning-goby", scientificName: "Elacatinus genie", kind: "reefFish" },
  { slug: "clown-wrasse", scientificName: "Halichoeres maculipinna", kind: "reefFish" },
  { slug: "cocoa-damselfish", scientificName: "Stegastes xanthurus", kind: "reefFish" },
  { slug: "colon-goby", scientificName: "Coryphopterus dicrus", kind: "reefFish" },
  { slug: "creole-wrasse", scientificName: "Clepticus parrae", kind: "schoolingFish" },
  { slug: "doctorfish", scientificName: "Acanthurus chirurgus", kind: "reefFish" },
  { slug: "dusky-damselfish", scientificName: "Stegastes adustus", kind: "reefFish" },
  { slug: "dusky-squirrelfish", scientificName: "Sargocentron vexillarium", kind: "reefFish" },
  { slug: "flagfin-mojarra", scientificName: "Eucinostomus melanopterus", kind: "reefFish" },
  { slug: "flamefish", scientificName: "Apogon maculatus", kind: "reefFish" },
  { slug: "foureye-butterflyfish", scientificName: "Chaetodon capistratus", kind: "reefFish" },
  { slug: "french-angelfish", scientificName: "Pomacanthus paru", kind: "reefFish" },
  { slug: "french-grunt", scientificName: "Haemulon flavolineatum", kind: "schoolingFish" },
  { slug: "gray-angelfish", scientificName: "Pomacanthus arcuatus", kind: "reefFish" },
  { slug: "gray-triggerfish", scientificName: "Balistes capriscus", kind: "reefFish" },
  { slug: "greater-soapfish", scientificName: "Rypticus saponaceus", kind: "reefFish" },
  { slug: "green-razorfish", scientificName: "Xyrichtys splendens", kind: "reefFish" },
  { slug: "harlequin-bass", scientificName: "Serranus tigrinus", kind: "reefFish" },
  { slug: "highhat", scientificName: "Pareques acuminatus", kind: "reefFish" },
  { slug: "honeycomb-cowfish", scientificName: "Acanthostracion polygonius", kind: "reefFish" },
  { slug: "hovering-dartfish", scientificName: "Ptereleotris helenae", kind: "reefFish" },
  { slug: "indigo-hamlet", scientificName: "Hypoplectrus indigo", kind: "reefFish" },
  { slug: "jackknife-fish", scientificName: "Equetus lanceolatus", kind: "reefFish" },
  { slug: "lane-snapper", scientificName: "Lutjanus synagris", kind: "reefFish" },
  { slug: "lantern-bass", scientificName: "Serranus baldwini", kind: "reefFish" },
  { slug: "longfin-damselfish", scientificName: "Stegastes diencaeus", kind: "reefFish" },
  { slug: "longjaw-squirrelfish", scientificName: "Neoniphon marianus", kind: "reefFish" },
  { slug: "longsnout-butterflyfish", scientificName: "Prognathodes aculeatus", kind: "reefFish" },
  { slug: "longspine-squirrelfish", scientificName: "Holocentrus rufus", kind: "reefFish" },
  { slug: "masked-goby", scientificName: "Coryphopterus personatus", kind: "reefFish" },
  { slug: "masked-hamlet", scientificName: "Hypoplectrus providencianus", kind: "reefFish" },
  { slug: "midnight-parrotfish", scientificName: "Scarus coelestinus", kind: "reefFish" },
  { slug: "neon-goby", scientificName: "Elacatinus oceanops", kind: "reefFish" },
  { slug: "night-sergeant", scientificName: "Abudefduf taurus", kind: "reefFish" },
  { slug: "ocean-surgeonfish", scientificName: "Acanthurus tractus", kind: "reefFish" },
  { slug: "orangesided-goby", scientificName: "Tigrigobius dilepis", kind: "reefFish" },
  { slug: "orangespotted-filefish", scientificName: "Cantherhines pullus", kind: "reefFish" },
  { slug: "pallid-goby", scientificName: "Coryphopterus eidolon", kind: "reefFish" },
  { slug: "peppermint-goby", scientificName: "Coryphopterus lipernes", kind: "reefFish" },
  { slug: "porkfish", scientificName: "Anisotremus virginicus", kind: "schoolingFish" },
  { slug: "princess-parrotfish", scientificName: "Scarus taeniopterus", kind: "reefFish" },
  { slug: "puddingwife", scientificName: "Halichoeres radiatus", kind: "reefFish" },
  { slug: "purple-reeffish", scientificName: "Chromis scotti", kind: "reefFish" },
  { slug: "queen-angelfish", scientificName: "Holacanthus ciliaris", kind: "reefFish" },
  { slug: "queen-parrotfish", scientificName: "Scarus vetula", kind: "reefFish" },
  { slug: "rainbow-parrotfish", scientificName: "Scarus guacamaia", kind: "reefFish" },
  { slug: "redband-parrotfish", scientificName: "Sparisoma aurofrenatum", kind: "reefFish" },
  { slug: "redlip-blenny", scientificName: "Ophioblennius macclurei", kind: "reefFish" },
  { slug: "redspotted-hawkfish", scientificName: "Amblycirrhitus pinos", kind: "reefFish" },
  { slug: "redtail-parrotfish", scientificName: "Sparisoma chrysopterum", kind: "reefFish" },
  { slug: "reef-butterflyfish", scientificName: "Chaetodon sedentarius", kind: "reefFish" },
  { slug: "rock-beauty", scientificName: "Holacanthus tricolor", kind: "reefFish" },
  { slug: "rosy-razorfish", scientificName: "Xyrichtys martinicensis", kind: "reefFish" },
  { slug: "roughhead-blenny", scientificName: "Acanthemblemaria aspera", kind: "reefFish" },
  { slug: "royal-gramma", scientificName: "Gramma loreto", kind: "reefFish" },
  { slug: "saddled-blenny", scientificName: "Malacoctenus triangulatus", kind: "reefFish" },
  { slug: "sailfin-blenny", scientificName: "Emblemaria pandionis", kind: "reefFish" },
  { slug: "sand-perch", scientificName: "Diplectrum formosum", kind: "reefFish" },
  { slug: "sand-tilefish", scientificName: "Malacanthus plumieri", kind: "reefFish" },
  { slug: "sargassum-triggerfish", scientificName: "Xanthichthys ringens", kind: "reefFish" },
  { slug: "saucereye-porgy", scientificName: "Calamus calamus", kind: "reefFish" },
  { slug: "scrawled-cowfish", scientificName: "Acanthostracion quadricornis", kind: "reefFish" },
  { slug: "seaweed-blenny", scientificName: "Parablennius marmoreus", kind: "reefFish" },
  { slug: "sergeant-major", scientificName: "Abudefduf saxatilis", kind: "reefFish" },
  { slug: "sharknose-goby", scientificName: "Elacatinus evelynae", kind: "reefFish" },
  { slug: "sheepshead", scientificName: "Archosargus probatocephalus", kind: "reefFish" },
  { slug: "shortstripe-goby", scientificName: "Elacatinus chancei", kind: "reefFish" },
  { slug: "shy-hamlet", scientificName: "Hypoplectrus guttavarius", kind: "reefFish" },
  { slug: "silver-porgy", scientificName: "Diplodus caudimacula", kind: "reefFish" },
  { slug: "slippery-dick", scientificName: "Halichoeres bivittatus", kind: "reefFish" },
  { slug: "spinyhead-blenny", scientificName: "Acanthemblemaria spinosa", kind: "reefFish" },
  { slug: "splendid-toadfish", scientificName: "Sanopus splendidus", kind: "reefFish" },
  { slug: "spotfin-butterflyfish", scientificName: "Chaetodon ocellatus", kind: "reefFish" },
  { slug: "spottail-pinfish", scientificName: "Diplodus holbrookii", kind: "reefFish" },
  { slug: "spotted-drum", scientificName: "Equetus punctatus", kind: "reefFish" },
  { slug: "spotted-goatfish", scientificName: "Pseudupeneus maculatus", kind: "reefFish" },
  { slug: "stoplight-parrotfish", scientificName: "Sparisoma viride", kind: "reefFish" },
  { slug: "striped-parrotfish", scientificName: "Scarus iseri", kind: "reefFish" },
  { slug: "sunshinefish", scientificName: "Chromis insolata", kind: "reefFish" },
  { slug: "threespot-damselfish", scientificName: "Stegastes planifrons", kind: "reefFish" },
  { slug: "tobaccofish", scientificName: "Serranus tabacarius", kind: "reefFish" },
  { slug: "trumpetfish", scientificName: "Aulostomus maculatus", kind: "reefFish" },
  { slug: "twospot-cardinalfish", scientificName: "Apogon pseudomaculatus", kind: "reefFish" },
  { slug: "white-grunt", scientificName: "Haemulon plumierii", kind: "schoolingFish" },
  { slug: "whitespotted-filefish", scientificName: "Cantherhines macrocerus", kind: "reefFish" },
  { slug: "yellowbelly-hamlet", scientificName: "Hypoplectrus aberrans", kind: "reefFish" },
  { slug: "yellowcheek-wrasse", scientificName: "Halichoeres cyanocephalus", kind: "reefFish" },
  { slug: "yellowfin-mojarra", scientificName: "Gerres cinereus", kind: "reefFish" },
  { slug: "yellowhead-jawfish", scientificName: "Opistognathus aurifrons", kind: "reefFish" },
  { slug: "yellowhead-wrasse", scientificName: "Halichoeres garnoti", kind: "reefFish" },
  { slug: "yellowline-goby", scientificName: "Elacatinus horsti", kind: "reefFish" },
  { slug: "yellownose-goby", scientificName: "Elacatinus randalli", kind: "reefFish" },
  { slug: "yellowtail-damselfish", scientificName: "Microspathodon chrysurus", kind: "reefFish" },
  { slug: "yellowtail-hamlet", scientificName: "Hypoplectrus chlorurus", kind: "reefFish" },
  { slug: "yellowtail-parrotfish", scientificName: "Sparisoma rubripinne", kind: "reefFish" },
  // --- Bigger fish ----------------------------------------------------------
  { slug: "almaco-jack", scientificName: "Seriola rivoliana", kind: "predator" },
  { slug: "atlantic-spadefish", scientificName: "Chaetodipterus faber", kind: "schoolingFish" },
  { slug: "bar-jack", scientificName: "Caranx ruber", kind: "predator" },
  { slug: "bermuda-chub", scientificName: "Kyphosus sectatrix", kind: "schoolingFish" },
  { slug: "black-durgon", scientificName: "Melichthys niger", kind: "reefFish" },
  { slug: "black-grouper", scientificName: "Mycteroperca bonaci", kind: "predator" },
  { slug: "blue-runner", scientificName: "Caranx crysos", kind: "schoolingFish" },
  { slug: "boga", scientificName: "Haemulon vittatum", kind: "schoolingFish" },
  { slug: "bonefish", scientificName: "Albula vulpes", kind: "predator" },
  { slug: "caesar-grunt", scientificName: "Haemulon carbonarium", kind: "schoolingFish" },
  { slug: "cero", scientificName: "Scomberomorus regalis", kind: "predator" },
  { slug: "cobia", scientificName: "Rachycentron canadum", kind: "predator" },
  { slug: "common-snook", scientificName: "Centropomus undecimalis", kind: "predator" },
  { slug: "coney", scientificName: "Cephalopholis fulva", kind: "predator" },
  { slug: "cottonwick", scientificName: "Haemulon melanurum", kind: "schoolingFish" },
  { slug: "creolefish", scientificName: "Paranthias furcifer", kind: "schoolingFish" },
  { slug: "crevalle-jack", scientificName: "Caranx hippos", kind: "predator" },
  { slug: "cubera-snapper", scientificName: "Lutjanus cyanopterus", kind: "predator" },
  { slug: "dog-snapper", scientificName: "Lutjanus jocu", kind: "predator" },
  { slug: "gag", scientificName: "Mycteroperca microlepis", kind: "predator" },
  { slug: "glasseye-snapper", scientificName: "Heteropriacanthus cruentatus", kind: "reefFish" },
  { slug: "goliath-grouper", scientificName: "Epinephelus itajara", kind: "predator" },
  { slug: "gray-snapper", scientificName: "Lutjanus griseus", kind: "schoolingFish" },
  { slug: "graysby", scientificName: "Cephalopholis cruentata", kind: "predator" },
  { slug: "great-barracuda", scientificName: "Sphyraena barracuda", kind: "predator" },
  { slug: "greater-amberjack", scientificName: "Seriola dumerili", kind: "predator" },
  { slug: "hardhead-silverside", scientificName: "Atherinomorus stipes", kind: "schoolingFish" },
  { slug: "hogfish", scientificName: "Lachnolaimus maximus", kind: "reefFish" },
  { slug: "horse-eye-jack", scientificName: "Caranx latus", kind: "schoolingFish" },
  { slug: "mahogany-snapper", scientificName: "Lutjanus mahogoni", kind: "schoolingFish" },
  { slug: "mutton-snapper", scientificName: "Lutjanus analis", kind: "predator" },
  { slug: "nassau-grouper", scientificName: "Epinephelus striatus", kind: "predator" },
  { slug: "ocean-triggerfish", scientificName: "Canthidermis sufflamen", kind: "reefFish" },
  { slug: "permit-fish", scientificName: "Trachinotus falcatus", kind: "predator" },
  { slug: "rainbow-runner", scientificName: "Elagatis bipinnulata", kind: "predator" },
  { slug: "red-grouper", scientificName: "Epinephelus morio", kind: "predator" },
  { slug: "red-hind", scientificName: "Epinephelus guttatus", kind: "predator" },
  { slug: "remora", scientificName: "Echeneis naucrates", kind: "reefFish" },
  { slug: "rock-hind", scientificName: "Epinephelus adscensionis", kind: "predator" },
  { slug: "round-scad", scientificName: "Decapterus punctatus", kind: "schoolingFish" },
  { slug: "sailors-choice", scientificName: "Haemulon parra", kind: "schoolingFish" },
  { slug: "scamp", scientificName: "Mycteroperca phenax", kind: "predator" },
  { slug: "schoolmaster-snapper", scientificName: "Lutjanus apodus", kind: "schoolingFish" },
  { slug: "smallmouth-grunt", scientificName: "Haemulon chrysargyreum", kind: "schoolingFish" },
  { slug: "southern-sennet", scientificName: "Sphyraena picudilla", kind: "schoolingFish" },
  { slug: "spanish-grunt", scientificName: "Haemulon macrostomum", kind: "schoolingFish" },
  { slug: "tarpon", scientificName: "Megalops atlanticus", kind: "predator" },
  { slug: "tiger-grouper", scientificName: "Mycteroperca tigris", kind: "predator" },
  { slug: "tomtate", scientificName: "Haemulon aurolineatum", kind: "schoolingFish" },
  { slug: "vermilion-snapper", scientificName: "Rhomboplites aurorubens", kind: "schoolingFish" },
  { slug: "wahoo", scientificName: "Acanthocybium solandri", kind: "predator" },
  { slug: "whale-shark", scientificName: "Rhincodon typus", kind: "shark" },
  { slug: "white-margate", scientificName: "Haemulon album", kind: "schoolingFish" },
  { slug: "yellow-goatfish", scientificName: "Mulloidichthys martinicus", kind: "schoolingFish" },
  { slug: "yellow-jack", scientificName: "Caranx bartholomaei", kind: "predator" },
  { slug: "yellowfin-grouper", scientificName: "Mycteroperca venenosa", kind: "predator" },
  { slug: "yellowmouth-grouper", scientificName: "Mycteroperca interstitialis", kind: "predator" },
  { slug: "yellowtail-snapper", scientificName: "Ocyurus chrysurus", kind: "schoolingFish" },
  // --- Sharks and rays ------------------------------------------------------
  { slug: "blacknose-shark", scientificName: "Carcharhinus acronotus", kind: "shark" },
  { slug: "blacktip-shark", scientificName: "Carcharhinus limbatus", kind: "shark" },
  { slug: "bull-shark", scientificName: "Carcharhinus leucas", kind: "shark" },
  { slug: "caribbean-reef-shark", scientificName: "Carcharhinus perezi", kind: "shark" },
  { slug: "giant-manta-ray", scientificName: "Mobula birostris", kind: "ray" },
  { slug: "great-hammerhead", scientificName: "Sphyrna mokarran", kind: "shark" },
  { slug: "lemon-shark", scientificName: "Negaprion brevirostris", kind: "shark" },
  { slug: "nurse-shark", scientificName: "Ginglymostoma cirratum", kind: "shark" },
  { slug: "oceanic-whitetip-shark", scientificName: "Carcharhinus longimanus", kind: "shark" },
  { slug: "roughtail-stingray", scientificName: "Bathytoshia centroura", kind: "ray" },
  { slug: "scalloped-hammerhead", scientificName: "Sphyrna lewini", kind: "shark" },
  { slug: "silky-shark", scientificName: "Carcharhinus falciformis", kind: "shark" },
  { slug: "southern-stingray", scientificName: "Hypanus americanus", kind: "ray" },
  { slug: "spotted-eagle-ray", scientificName: "Aetobatus narinari", kind: "ray" },
  { slug: "tiger-shark", scientificName: "Galeocerdo cuvier", kind: "shark" },
  { slug: "yellow-stingray", scientificName: "Urobatis jamaicensis", kind: "ray" },
  // --- Eels and ambush hunters ----------------------------------------------
  { slug: "bluethroat-pikeblenny", scientificName: "Chaenopsis ocellata", kind: "camouflage" },
  { slug: "bridled-goby", scientificName: "Coryphopterus glaucofraenum", kind: "camouflage" },
  { slug: "chain-moray", scientificName: "Echidna catenata", kind: "eel" },
  { slug: "garden-eel", scientificName: "Heteroconger longissimus", kind: "eel" },
  { slug: "goldentail-moray", scientificName: "Gymnothorax miliaris", kind: "eel" },
  { slug: "goldspot-goby", scientificName: "Gnatholepis thompsoni", kind: "camouflage" },
  { slug: "goldspotted-eel", scientificName: "Myrichthys ocellatus", kind: "eel" },
  { slug: "green-moray", scientificName: "Gymnothorax funebris", kind: "eel" },
  { slug: "hairy-blenny", scientificName: "Labrisomus nuchipinnis", kind: "camouflage" },
  { slug: "lancer-dragonet", scientificName: "Callionymus bairdi", kind: "camouflage" },
  { slug: "lionfish", scientificName: "Pterois volitans", kind: "invasive" },
  { slug: "longlure-frogfish", scientificName: "Antennarius multiocellatus", kind: "camouflage" },
  { slug: "longnose-batfish", scientificName: "Ogcocephalus corniger", kind: "camouflage" },
  { slug: "peacock-flounder", scientificName: "Bothus lunatus", kind: "camouflage" },
  { slug: "sand-diver", scientificName: "Synodus intermedius", kind: "camouflage" },
  { slug: "sharptail-eel", scientificName: "Myrichthys breviceps", kind: "eel" },
  { slug: "spotted-moray", scientificName: "Gymnothorax moringa", kind: "eel" },
  { slug: "spotted-scorpionfish", scientificName: "Scorpaena plumieri", kind: "camouflage" },
  { slug: "spotted-snake-eel", scientificName: "Ophichthus ophis", kind: "eel" },
  // --- Reef oddities --------------------------------------------------------
  { slug: "balloonfish", scientificName: "Diodon holocanthus", kind: "reefFish" },
  { slug: "bandtail-puffer", scientificName: "Sphoeroides spengleri", kind: "reefFish" },
  { slug: "blackbar-soldierfish", scientificName: "Myripristis jacobus", kind: "reefFish" },
  { slug: "flying-gurnard", scientificName: "Dactylopterus volitans", kind: "reefFish" },
  { slug: "glassy-sweeper", scientificName: "Pempheris schomburgkii", kind: "schoolingFish" },
  { slug: "longsnout-seahorse", scientificName: "Hippocampus reidi", kind: "reefFish" },
  { slug: "porcupinefish", scientificName: "Diodon hystrix", kind: "reefFish" },
  { slug: "queen-triggerfish", scientificName: "Balistes vetula", kind: "reefFish" },
  { slug: "scrawled-filefish", scientificName: "Aluterus scriptus", kind: "reefFish" },
  { slug: "sharpnose-puffer", scientificName: "Canthigaster rostrata", kind: "reefFish" },
  { slug: "smooth-trunkfish", scientificName: "Lactophrys triqueter", kind: "reefFish" },
  { slug: "spanish-hogfish", scientificName: "Bodianus rufus", kind: "reefFish" },
  { slug: "spotted-trunkfish", scientificName: "Lactophrys bicaudalis", kind: "reefFish" },
  { slug: "squirrelfish", scientificName: "Holocentrus adscensionis", kind: "reefFish" },
  // --- Turtles and mammals --------------------------------------------------
  { slug: "atlantic-spotted-dolphin", scientificName: "Stenella frontalis", kind: "marineMammal" },
  { slug: "bottlenose-dolphin", scientificName: "Tursiops truncatus", kind: "marineMammal" },
  { slug: "green-sea-turtle", scientificName: "Chelonia mydas", kind: "turtle" },
  { slug: "hawksbill-turtle", scientificName: "Eretmochelys imbricata", kind: "turtle" },
  { slug: "humpback-whale", scientificName: "Megaptera novaeangliae", kind: "marineMammal" },
  { slug: "leatherback-sea-turtle", scientificName: "Dermochelys coriacea", kind: "turtle" },
  { slug: "loggerhead-turtle", scientificName: "Caretta caretta", kind: "turtle" },
  { slug: "manatee", scientificName: "Trichechus manatus", kind: "marineMammal" },
  // --- Invertebrates --------------------------------------------------------
  { slug: "arrow-crab", scientificName: "Stenorhynchus seticornis", kind: "crustacean" },
  { slug: "atlantic-common-octopus", scientificName: "Octopus americanus", kind: "mollusc" },
  { slug: "atlantic-longarm-octopus", scientificName: "Macrotritopus defilippi", kind: "mollusc" },
  { slug: "banded-coral-shrimp", scientificName: "Stenopus hispidus", kind: "crustacean" },
  { slug: "batwing-coral-crab", scientificName: "Carpilius corallinus", kind: "crustacean" },
  { slug: "beaded-sea-cucumber", scientificName: "Euapta lappa", kind: "reefInvertebrate" },
  { slug: "bearded-fireworm", scientificName: "Hermodice carunculata", kind: "reefInvertebrate" },
  { slug: "black-tunicate", scientificName: "Phallusia nigra", kind: "reefInvertebrate" },
  {
    slug: "bluebell-tunicate",
    scientificName: "Clavelina puertosecensis",
    kind: "reefInvertebrate",
  },
  { slug: "branching-anemone", scientificName: "Lebrunia neglecta", kind: "reefInvertebrate" },
  { slug: "brazilian-reef-octopus", scientificName: "Octopus insularis", kind: "mollusc" },
  { slug: "cannonball-jelly", scientificName: "Stomolophus meleagris", kind: "drifter" },
  { slug: "caribbean-reef-octopus", scientificName: "Octopus briareus", kind: "mollusc" },
  { slug: "caribbean-reef-squid", scientificName: "Sepioteuthis sepioidea", kind: "mollusc" },
  { slug: "channel-clinging-crab", scientificName: "Mithrax spinosissimus", kind: "crustacean" },
  { slug: "christmas-tree-hydroid", scientificName: "Pennaria disticha", kind: "reefInvertebrate" },
  {
    slug: "christmas-tree-worm",
    scientificName: "Spirobranchus giganteus",
    kind: "reefInvertebrate",
  },
  { slug: "corkscrew-anemone", scientificName: "Bartholomea annulata", kind: "reefInvertebrate" },
  { slug: "cushion-sea-star", scientificName: "Oreaster reticulatus", kind: "reefInvertebrate" },
  {
    slug: "donkey-dung-sea-cucumber",
    scientificName: "Holothuria mexicana",
    kind: "reefInvertebrate",
  },
  { slug: "dushia-flabellina", scientificName: "Edmundsella dushia", kind: "mollusc" },
  {
    slug: "feather-duster-worm",
    scientificName: "Sabellastarte magnifica",
    kind: "reefInvertebrate",
  },
  { slug: "fingerprint-cyphoma", scientificName: "Cyphoma signatum", kind: "mollusc" },
  { slug: "flame-box-crab", scientificName: "Calappa flammea", kind: "crustacean" },
  { slug: "flamingo-tongue", scientificName: "Cyphoma gibbosum", kind: "mollusc" },
  { slug: "florida-horse-conch", scientificName: "Triplofusus giganteus", kind: "mollusc" },
  { slug: "giant-anemone", scientificName: "Condylactis gigantea", kind: "reefInvertebrate" },
  { slug: "giant-basket-star", scientificName: "Astrophyton muricatum", kind: "reefInvertebrate" },
  { slug: "giant-hermit-crab", scientificName: "Petrochirus diogenes", kind: "crustacean" },
  { slug: "golden-coral-shrimp", scientificName: "Stenopus scutellatus", kind: "crustacean" },
  { slug: "golden-crinoid", scientificName: "Davidaster rubiginosus", kind: "reefInvertebrate" },
  { slug: "green-clinging-crab", scientificName: "Mithraculus sculptus", kind: "crustacean" },
  { slug: "lettuce-sea-slug", scientificName: "Elysia crispata", kind: "mollusc" },
  { slug: "long-spined-urchin", scientificName: "Diadema antillarum", kind: "reefInvertebrate" },
  { slug: "moon-jelly", scientificName: "Aurelia aurita", kind: "drifter" },
  { slug: "nimble-spray-crab", scientificName: "Percnon gibbesi", kind: "crustacean" },
  { slug: "orangeclaw-hermit-crab", scientificName: "Calcinus tibicen", kind: "crustacean" },
  { slug: "pederson-cleaner-shrimp", scientificName: "Ancylomenes pedersoni", kind: "crustacean" },
  { slug: "pink-meanie", scientificName: "Drymonema larsoni", kind: "drifter" },
  { slug: "portuguese-man-o-war", scientificName: "Physalia physalis", kind: "drifter" },
  { slug: "queen-conch", scientificName: "Aliger gigas", kind: "mollusc" },
  { slug: "ragged-sea-hare", scientificName: "Bursatella leachii", kind: "mollusc" },
  { slug: "red-reef-hermit", scientificName: "Paguristes cadenati", kind: "crustacean" },
  { slug: "reef-urchin", scientificName: "Echinometra viridis", kind: "reefInvertebrate" },
  { slug: "rock-boring-urchin", scientificName: "Echinometra lucunter", kind: "reefInvertebrate" },
  { slug: "sea-walnut", scientificName: "Mnemiopsis leidyi", kind: "drifter" },
  {
    slug: "slate-pencil-urchin",
    scientificName: "Eucidaris tribuloides",
    kind: "reefInvertebrate",
  },
  { slug: "slipper-lobster", scientificName: "Parribacus antarcticus", kind: "crustacean" },
  { slug: "social-feather-duster", scientificName: "Bispira brunnea", kind: "reefInvertebrate" },
  { slug: "spanish-lobster", scientificName: "Scyllarides aequinoctialis", kind: "crustacean" },
  { slug: "spiny-lobster", scientificName: "Panulirus argus", kind: "crustacean" },
  {
    slug: "split-crown-feather-duster",
    scientificName: "Anamobaea orstedii",
    kind: "reefInvertebrate",
  },
  { slug: "sponge-brittle-star", scientificName: "Ophiothrix suensonii", kind: "reefInvertebrate" },
  { slug: "spot-winged-comb-jelly", scientificName: "Ocyropsis maculata", kind: "drifter" },
  {
    slug: "spotted-cleaner-shrimp",
    scientificName: "Periclimenes yucatanicus",
    kind: "crustacean",
  },
  { slug: "spotted-sea-hare", scientificName: "Aplysia dactylomela", kind: "mollusc" },
  { slug: "spotted-spiny-lobster", scientificName: "Panulirus guttatus", kind: "crustacean" },
  {
    slug: "star-horseshoe-worm",
    scientificName: "Pomatostegus stellatus",
    kind: "reefInvertebrate",
  },
  { slug: "sun-anemone", scientificName: "Stichodactyla helianthus", kind: "reefInvertebrate" },
  { slug: "sun-anemone-shrimp", scientificName: "Periclimenes rathbunae", kind: "crustacean" },
  {
    slug: "three-rowed-sea-cucumber",
    scientificName: "Isostichopus badionotus",
    kind: "reefInvertebrate",
  },
  { slug: "true-tulip", scientificName: "Fasciolaria tulipa", kind: "mollusc" },
  { slug: "upside-down-jellyfish", scientificName: "Cassiopea xamachana", kind: "drifter" },
  {
    slug: "variegated-sea-urchin",
    scientificName: "Lytechinus variegatus",
    kind: "reefInvertebrate",
  },
  {
    slug: "west-indian-sea-egg",
    scientificName: "Tripneustes ventricosus",
    kind: "reefInvertebrate",
  },
  {
    slug: "white-encrusting-zoanthid",
    scientificName: "Palythoa caribaeorum",
    kind: "reefInvertebrate",
  },
  // --- Corals, sponges and the reef itself ----------------------------------
  { slug: "azure-vase-sponge", scientificName: "Callyspongia plicifera", kind: "sponge" },
  { slug: "black-coral", scientificName: "Antipathes caribbeana", kind: "softCoral" },
  { slug: "black-sea-rod", scientificName: "Plexaura homomalla", kind: "softCoral" },
  { slug: "blade-fire-coral", scientificName: "Millepora complanata", kind: "hardCoral" },
  { slug: "boulder-brain-coral", scientificName: "Colpophyllia natans", kind: "hardCoral" },
  { slug: "boulder-star-coral", scientificName: "Orbicella annularis", kind: "hardCoral" },
  { slug: "branching-tube-sponge", scientificName: "Aiolochroia crassa", kind: "sponge" },
  { slug: "branching-vase-sponge", scientificName: "Callyspongia vaginalis", kind: "sponge" },
  { slug: "brown-encrusting-octopus-sponge", scientificName: "Ectyoplasia ferox", kind: "sponge" },
  { slug: "brown-tube-sponge", scientificName: "Agelas conifera", kind: "sponge" },
  { slug: "common-sea-fan", scientificName: "Gorgonia ventalina", kind: "softCoral" },
  { slug: "corky-sea-finger", scientificName: "Briareum asbestinum", kind: "softCoral" },
  { slug: "elkhorn-coral", scientificName: "Acropora palmata", kind: "hardCoral" },
  { slug: "encrusting-gorgonian", scientificName: "Erythropodium caribaeorum", kind: "softCoral" },
  { slug: "finger-coral", scientificName: "Porites porites", kind: "hardCoral" },
  { slug: "fire-coral", scientificName: "Millepora alcicornis", kind: "hardCoral" },
  { slug: "giant-barrel-sponge", scientificName: "Xestospongia muta", kind: "sponge" },
  { slug: "great-star-coral", scientificName: "Montastraea cavernosa", kind: "hardCoral" },
  { slug: "green-finger-sponge", scientificName: "Iotrochota birotulata", kind: "sponge" },
  { slug: "grooved-brain-coral", scientificName: "Diploria labyrinthiformis", kind: "hardCoral" },
  { slug: "knobby-brain-coral", scientificName: "Pseudodiploria clivosa", kind: "hardCoral" },
  { slug: "lamarcks-sheet-coral", scientificName: "Agaricia lamarcki", kind: "hardCoral" },
  { slug: "lavender-rope-sponge", scientificName: "Niphates erecta", kind: "sponge" },
  { slug: "lesser-starlet-coral", scientificName: "Siderastrea radians", kind: "hardCoral" },
  { slug: "lettuce-coral", scientificName: "Agaricia agaricites", kind: "hardCoral" },
  { slug: "lumpy-overgrowing-sponge", scientificName: "Desmapsamma anchorata", kind: "sponge" },
  { slug: "massive-starlet-coral", scientificName: "Siderastrea siderea", kind: "hardCoral" },
  { slug: "maze-coral", scientificName: "Meandrina meandrites", kind: "hardCoral" },
  { slug: "mountainous-star-coral", scientificName: "Orbicella faveolata", kind: "hardCoral" },
  { slug: "mustard-hill-coral", scientificName: "Porites astreoides", kind: "hardCoral" },
  { slug: "netted-barrel-sponge", scientificName: "Verongula gigantea", kind: "sponge" },
  { slug: "orange-cup-coral", scientificName: "Tubastraea coccinea", kind: "hardCoral" },
  { slug: "orange-elephant-ear-sponge", scientificName: "Agelas clathrodes", kind: "sponge" },
  { slug: "pillar-coral", scientificName: "Dendrogyra cylindrus", kind: "hardCoral" },
  { slug: "pink-vase-sponge", scientificName: "Niphates digitalis", kind: "sponge" },
  { slug: "pitted-sponge", scientificName: "Verongula rigida", kind: "sponge" },
  { slug: "red-boring-sponge", scientificName: "Cliothosa delitrix", kind: "sponge" },
  { slug: "red-rope-sponge", scientificName: "Amphimedon compressa", kind: "sponge" },
  { slug: "rose-coral", scientificName: "Manicina areolata", kind: "hardCoral" },
  { slug: "row-pore-rope-sponge", scientificName: "Aplysina cauliformis", kind: "sponge" },
  { slug: "scattered-pore-rope-sponge", scientificName: "Aplysina fulva", kind: "sponge" },
  { slug: "sea-plume", scientificName: "Antillogorgia species", kind: "softCoral" },
  { slug: "smooth-flower-coral", scientificName: "Eusmilia fastigiata", kind: "hardCoral" },
  { slug: "staghorn-coral", scientificName: "Acropora cervicornis", kind: "hardCoral" },
  { slug: "stinker-sponge", scientificName: "Ircinia felix", kind: "sponge" },
  { slug: "stovepipe-sponge", scientificName: "Aplysina archeri", kind: "sponge" },
  { slug: "symmetrical-brain-coral", scientificName: "Pseudodiploria strigosa", kind: "hardCoral" },
  { slug: "turtle-grass", scientificName: "Thalassia testudinum", kind: "seagrass" },
  { slug: "vase-sponge", scientificName: "Ircinia campana", kind: "sponge" },
  { slug: "yellow-pencil-coral", scientificName: "Madracis auretenra", kind: "hardCoral" },
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
