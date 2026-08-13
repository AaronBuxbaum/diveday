// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see the doc comment
import type { GlobalDiveSiteBriefing } from "./schema";

/**
 * DiveDay's published dive-site catalog: real places, written up as a briefing
 * a shop can import and then make its own.
 *
 * **Florida, deliberately.** The catalog held exactly one site — Molasses Reef,
 * written inline in the demo seed — so "Browse templates" was a page with one
 * card on it and the feature it advertised (start from a site your crew already
 * knows) did not exist. These thirty-four are the state's working dive sites:
 * the Keys reef line and its wrecks, the south-east coast, the Panhandle, and
 * the freshwater springs that are half of Florida diving and appear in nobody
 * else's idea of a dive-site catalog.
 *
 * **These are starting words, not app copy** — the same contract
 * `./course-templates.ts` and `./marine-life-catalog.ts` have, and the reason
 * this file is exempt from the message-bundle rule. Importing copies the whole
 * briefing into the shop's own row (`importGlobalDiveSiteTemplate`), where the
 * shop rewrites whatever it likes in its own language. Nothing here is read
 * again afterwards, so publishing a correction never overwrites what a shop
 * put on its own page.
 *
 * **What the numbers mean.** Coordinates are the published position of the site
 * — a lighthouse, a sanctuary marker, a wreck's recorded resting place, a
 * spring's own mouth — accurate enough to centre a map and read a forecast at,
 * and *not* a mooring assignment: a shop confirms its own buoy and edits the
 * point. Depths are the site's real published range; the `maxDepthMeters` is
 * what a certification ceiling gets compared against (H-08), so it is the
 * deepest sand at the site rather than the depth a typical dive runs to.
 *
 * **Certification gates are the conservative reading.** A wreck below 30 m
 * carries Advanced Open Water and the Deep specialty because that is what its
 * depth demands of a diver in open water — never because penetration is
 * implied, which is a different card and a different dive. A shop that runs a
 * site differently edits the gate; nothing here is the last word, and the trip
 * composes the stricter of the two anyway (`src/lib/readiness.ts`).
 */
export type DiveSiteTemplate = {
  slug: string;
  version: number;
  briefing: GlobalDiveSiteBriefing;
};

export const DIVE_SITE_TEMPLATES: DiveSiteTemplate[] = [
  // ─── Upper Keys: Key Largo ────────────────────────────────────────────────
  {
    slug: "molasses-reef",
    version: 2,
    briefing: {
      name: "Molasses Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.0117,
      forecastLongitude: -80.3764,
      description:
        "The most-dived reef in the Keys, and it earns it: spur-and-groove coral fingers running out into sand channels, in water that is usually bright enough to see the whole thing.",
      marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
      marineLifeDescription:
        "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels between the spurs.",
      difficultyLevel: "beginner",
      depthRange: "6–12 m (20–40 ft)",
      maxDepthMeters: 12,
      currentNote: "Usually gentle, but it sits on the reef line and can run — the crew calls it.",
      divePlan:
        "Follow a coral ridge out from the mooring, cross at a sand channel, and drift back along the next spur to the shallow garden under the boat.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, bright, and forgiving — a good first ocean dive after a pool course, and still worth a hundredth.",
      landmarks: [
        {
          name: "Molasses Reef Light",
          kind: "navigationMark",
          note: "The steel tower is the easiest above-water reference on the reef, and the way to stay oriented all dive.",
        },
        {
          name: "Winch Hole",
          kind: "reefHistory",
          note: "A ship's winch sitting on the bottom in about 12 m, worn smooth and grown over.",
        },
        {
          name: "Spanish anchor",
          kind: "reefHistory",
          note: "An old anchor among the coral. Let the crew point it out — it disappears into the reef remarkably well.",
        },
      ],
      creatureSlugs: [
        "stoplight-parrotfish",
        "french-angelfish",
        "blue-tang",
        "southern-stingray",
        "elkhorn-coral",
        "yellowtail-snapper",
      ],
    },
  },
  {
    slug: "french-reef",
    version: 1,
    briefing: {
      name: "French Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.0353,
      forecastLongitude: -80.3494,
      description:
        "The swim-through reef. Ledges, overhangs and short tunnels cut through a shallow spur-and-groove system, so the dive happens as much under the coral as over it.",
      marineLife: "Nurse sharks · green morays · parrotfish · barracuda",
      marineLifeDescription:
        "The overhangs hide sleeping nurse sharks and squirrelfish. Check the ceilings, not just the sand.",
      difficultyLevel: "beginner",
      depthRange: "5–14 m (15–45 ft)",
      maxDepthMeters: 14,
      currentNote: "Usually mild; a swim-through is no place to be surprised by surge.",
      divePlan:
        "Drop on the mooring, work the ledges into the current, then drift back over the coral heads with air in hand for the swim-throughs.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and easy-going, but the overhangs reward decent buoyancy — worth a few dives of practice first.",
      fieldGuideTipsHeading: "Look up, not just down",
      landmarks: [
        {
          name: "Christmas Tree Cave",
          kind: "reefFormation",
          note: "A short swim-through with two exits; the coral over the entrance is where it gets its name.",
        },
        {
          name: "Hourglass Cave",
          kind: "reefFormation",
          note: "Narrow in the middle and open at both ends — a good look at what lives on a ceiling.",
        },
        {
          name: "White Sand Bottom Cave",
          kind: "reefFormation",
          note: "The brightest of the tunnels, and usually the one with a nurse shark parked in it.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "green-moray",
        "stoplight-parrotfish",
        "great-barracuda",
        "squirrelfish",
        "blackbar-soldierfish",
      ],
    },
  },
  {
    slug: "christ-of-the-abyss",
    version: 1,
    briefing: {
      name: "Christ of the Abyss",
      locationName: "Key Largo Dry Rocks, John Pennekamp Coral Reef State Park",
      forecastLatitude: 25.1245,
      forecastLongitude: -80.2972,
      description:
        "A 2.6 m bronze statue standing on the sand in about 8 m of water, arms up toward the surface, with a shallow coral garden all around it. The most photographed dive in Florida.",
      marineLife: "Sergeant majors · blue tangs · French angelfish · brain coral",
      marineLifeDescription:
        "Sergeant majors guard purple egg patches on the statue's base all summer, and the coral heads around it are as good as anything deeper.",
      difficultyLevel: "beginner",
      depthRange: "5–8 m (15–25 ft)",
      maxDepthMeters: 8,
      currentNote: "Usually gentle; it is shallow enough that surface chop is felt on the bottom.",
      divePlan:
        "Arc from the mooring through the sand channels, spend the time you want at the statue, then return across the coral garden — most of the dive is above 6 m, so it is a long one.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, sheltered and busy. Snorkellers share the site, so this is a good day to stay low and let the surface belong to them.",
      landmarks: [
        {
          name: "Christ of the Abyss",
          kind: "underwaterMonument",
          note: "Cast in 1954 and placed here in 1965 — the third of three, and the reason most people are on the boat.",
        },
        {
          name: "Dry Rocks sand channels",
          kind: "reefFormation",
          note: "Bright channels weaving between the coral, and a good place to look for rays and grouper.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "blue-tang",
        "french-angelfish",
        "grooved-brain-coral",
        "elkhorn-coral",
        "yellow-stingray",
      ],
    },
  },
  {
    slug: "benwood-wreck",
    version: 1,
    briefing: {
      name: "Benwood Wreck",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.0527,
      forecastLongitude: -80.3337,
      description:
        "A freighter torpedoed off Key Largo in 1942, broken open and lying in shallow sand — wreck scale without wreck depth, and one of the best night dives in the Keys.",
      marineLife: "Glassy sweepers · sergeant majors · moray eels · yellowtail snapper",
      marineLifeDescription:
        "The hull is a fish apartment block. Look into every gap in the plates and something is home.",
      difficultyLevel: "intermediate",
      depthRange: "8–15 m (25–50 ft)",
      maxDepthMeters: 15,
      currentNote: "Mild, but it sits in open water off the reef line — the crew calls the drop.",
      divePlan:
        "Swim the length of the hull from bow to stern along the sand, then come back over the plates at about 9 m (30 ft) for the safety stop.",
      fitTone: "welcoming",
      fitNote:
        "Shallow enough for a long dive, and structured enough to be a real first wreck. Stay outside the plates.",
      landmarks: [
        {
          name: "Bow section",
          kind: "wreckFeature",
          note: "The most intact piece, standing proud of the sand and the easiest place to get your bearings.",
        },
        {
          name: "Collapsed midships plates",
          kind: "wreckFeature",
          note: "Where the hull opened up. Swim over it rather than into it — the gaps are fish holes, not doorways.",
        },
      ],
      creatureSlugs: [
        "glassy-sweeper",
        "sergeant-major",
        "spotted-moray",
        "yellowtail-snapper",
        "great-barracuda",
        "caribbean-reef-octopus",
      ],
    },
  },
  {
    slug: "spiegel-grove",
    version: 1,
    briefing: {
      name: "Spiegel Grove",
      locationName: "Key Largo, Florida",
      forecastLatitude: 25.0667,
      forecastLongitude: -80.3,
      description:
        "A 155 m Navy landing ship dock sunk as an artificial reef in 2002 and rolled upright by Hurricane Dennis in 2005. Big enough that a single dive is a tour of one end of it.",
      marineLife: "Goliath grouper · barracuda · jacks · soft coral",
      marineLifeDescription:
        "Expect big silhouettes, moving schools, and changing light along the exterior decks. The superstructure is thick with coral and sponge now.",
      difficultyLevel: "advanced",
      depthRange: "18–40 m (60–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Open-water current can run hard, and it is a long ship — the crew calls the line plan and the drop.",
      divePlan:
        "Descend together on the mooring line, tour the exterior — flight deck, cranes, well deck — and return to the ascent line with reserve gas and a planned stop.",
      fitTone: "demanding",
      fitNote:
        "Deep, exposed and current-prone. Nitrox and recent deep experience turn this from a short look into a proper dive.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Flight deck and cranes",
          kind: "wreckFeature",
          note: "The broad deck and paired cranes make the ship's scale click into place. Stay outside the structure and follow the guide's line.",
        },
        {
          name: "Well deck",
          kind: "wreckFeature",
          note: "The open stern space is the most dramatic exterior room on the wreck, with changing light and big schools working through it.",
        },
        {
          name: "The mast",
          kind: "wreckFeature",
          note: "The shallowest steel on the wreck at about 18 m — a useful reference on the way up.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "permit-fish",
        "yellowtail-snapper",
        "remora",
      ],
    },
  },
  {
    slug: "uscgc-duane",
    version: 1,
    briefing: {
      name: "USCGC Duane",
      locationName: "Key Largo, Florida",
      forecastLatitude: 25.0072,
      forecastLongitude: -80.3465,
      description:
        "A 100 m Coast Guard cutter sunk in 1987 and sitting perfectly upright, mast and gun mounts intact — the tidiest wreck in the Upper Keys, and the one everyone remembers the shape of.",
      marineLife: "Goliath grouper · barracuda · amberjack · schooling grunts",
      marineLifeDescription:
        "A resident goliath grouper often holds near the wheelhouse. Look out into the blue for jacks working the current off the bow.",
      difficultyLevel: "advanced",
      depthRange: "18–37 m (60–120 ft)",
      maxDepthMeters: 37,
      currentNote:
        "Can run strong on the surface and at depth; the crew calls the line and the drop order.",
      divePlan:
        "Descend the mooring to the deck, tour the superstructure and gun mounts, then ascend on reserve gas with a stop on the line — the crow's nest at about 18 m is a good place to spend it.",
      fitTone: "demanding",
      fitNote:
        "Deep and current-swept, but upright and intact enough to be an excellent first big wreck once the depth is within your card.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "Open, recognisable, and usually holding the resident grouper. Approach along the deck, not from above.",
        },
        {
          name: "Forward gun mount",
          kind: "wreckFeature",
          note: "Still trained out over the bow, and the picture everybody comes up with.",
        },
        {
          name: "Crow's nest",
          kind: "wreckFeature",
          note: "The shallowest point at about 18 m — where the safety stop happens on a good day.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "bluestriped-grunt",
        "spotted-moray",
        "great-star-coral",
      ],
    },
  },
  {
    slug: "grecian-rocks",
    version: 1,
    briefing: {
      name: "Grecian Rocks",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.1114,
      forecastLongitude: -80.3053,
      description:
        "A crescent of shallow reef that shelters its own back side — a coral garden in barely 3 m on one edge, sloping to sand at about 10 m on the other.",
      marineLife: "Elkhorn coral · sergeant majors · barracuda · queen conch",
      marineLifeDescription:
        "One of the better surviving elkhorn stands in the Upper Keys sits along the shallow crest.",
      difficultyLevel: "beginner",
      depthRange: "3–10 m (10–35 ft)",
      maxDepthMeters: 10,
      currentNote:
        "The back side is sheltered even when the reef line is not — a good bad-weather call.",
      divePlan:
        "Work the deeper sand edge first, then come up onto the crest and finish shallow among the coral heads with plenty of gas left.",
      fitTone: "welcoming",
      fitNote: "Shallow, sheltered and slow. The site where a nervous diver stops being nervous.",
      landmarks: [
        {
          name: "The elkhorn crest",
          kind: "reefFormation",
          note: "Antler coral in barely knee-deep water at the shallowest point. Keep fins high and well clear.",
        },
        {
          name: "Sand-edge coral heads",
          kind: "reefFormation",
          note: "Isolated heads out on the sand, each one holding its own small population.",
        },
      ],
      creatureSlugs: [
        "elkhorn-coral",
        "sergeant-major",
        "queen-conch",
        "great-barracuda",
        "foureye-butterflyfish",
        "smooth-trunkfish",
      ],
    },
  },
  {
    slug: "carysfort-reef",
    version: 1,
    briefing: {
      name: "Carysfort Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.2219,
      forecastLongitude: -80.2115,
      description:
        "The northernmost of the big Keys reefs, marked by an 1852 iron-pile lighthouse. Well offshore, less dived than Molasses, and the coral shows it.",
      marineLife: "Elkhorn coral · staghorn coral · parrotfish · nurse sharks",
      marineLifeDescription:
        "Long-running coral restoration plots sit on the reef here; the staghorn thickets are the reason the boat comes this far.",
      difficultyLevel: "intermediate",
      depthRange: "8–21 m (25–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Exposed and further offshore than the rest of the Key Largo line — current and surface conditions decide the day.",
      divePlan:
        "Drop on the outer reef, work along the spurs into whatever current is running, and finish shallow on the restoration plots.",
      fitTone: "demanding",
      fitNote:
        "Not hard water, but a long ride and an exposed site — best on a settled day and with a diver who is comfortable in a bit of current.",
      landmarks: [
        {
          name: "Carysfort Reef Light",
          kind: "navigationMark",
          note: "The rust-red iron tower standing straight out of the reef — visible for miles and impossible to lose.",
        },
        {
          name: "Coral restoration plots",
          kind: "reefFormation",
          note: "Nursery-grown staghorn out-planted on the reef. Look, photograph, and keep every part of you off them.",
        },
      ],
      creatureSlugs: [
        "staghorn-coral",
        "elkhorn-coral",
        "queen-parrotfish",
        "nurse-shark",
        "french-grunt",
        "banded-butterflyfish",
      ],
    },
  },
  {
    slug: "pickles-reef",
    version: 1,
    briefing: {
      name: "Pickles Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.9928,
      forecastLongitude: -80.4092,
      description:
        "A shallow spur-and-groove reef named for the barrel-shaped cement casks from a 19th-century wreck lying among the coral heads.",
      marineLife: "Blue tangs · stoplight parrotfish · French angelfish · sergeant majors",
      marineLifeDescription:
        "Grazing parrotfish work the coral heads all day; blue tangs move through in loose, easy groups.",
      difficultyLevel: "beginner",
      depthRange: "5–12 m (15–40 ft)",
      maxDepthMeters: 12,
      currentNote: "Usually gentle; the crew confirms the final plan.",
      divePlan:
        "Drift the coral ridge from the mooring, pause over the barrel casks, then loop back over the sand.",
      fitTone: "welcoming",
      fitNote: "Quiet, shallow and rarely crowded — a good second tank after something deeper.",
      landmarks: [
        {
          name: "The cement barrels",
          kind: "reefHistory",
          note: "Casks of cement that hardened in their barrels and outlasted the ship carrying them.",
        },
        {
          name: "Anchor chain remnant",
          kind: "reefHistory",
          note: "A length of chain grown into the reef, running off toward the sand.",
        },
      ],
      creatureSlugs: [
        "blue-tang",
        "stoplight-parrotfish",
        "french-angelfish",
        "sergeant-major",
        "spanish-hogfish",
        "christmas-tree-worm",
      ],
    },
  },

  // ─── Islamorada ───────────────────────────────────────────────────────────
  {
    slug: "alligator-reef",
    version: 1,
    briefing: {
      name: "Alligator Reef",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.8472,
      forecastLongitude: -80.6197,
      description:
        "A big, healthy reef under an 1873 skeletal lighthouse, named for a US schooner wrecked here in 1822. Shallow, busy with fish, and famous for how much of it you can see at once.",
      marineLife: "Tarpon · barracuda · schooling grunts · nurse sharks",
      marineLifeDescription:
        "Enormous schools sit in the cuts between the spurs, and tarpon patrol the deeper edge in summer.",
      difficultyLevel: "beginner",
      depthRange: "3–12 m (10–40 ft)",
      maxDepthMeters: 12,
      currentNote: "Runs with the tide through the cuts — an easy drift when it does.",
      divePlan:
        "Start at the deeper sand edge, work up through a cut into the shallow coral, and finish under the boat.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, bright and full of fish. If the current is running, the crew will make it a drift rather than a swim.",
      landmarks: [
        {
          name: "Alligator Reef Light",
          kind: "navigationMark",
          note: "The 41 m iron skeleton tower overhead — the reference point for the whole site.",
        },
        {
          name: "The cuts",
          kind: "reefFormation",
          note: "Sand channels between the coral spurs, where the fish stack up and the current does the swimming.",
        },
      ],
      creatureSlugs: [
        "tarpon",
        "great-barracuda",
        "french-grunt",
        "nurse-shark",
        "queen-angelfish",
        "elkhorn-coral",
      ],
    },
  },
  {
    slug: "eagle-wreck",
    version: 1,
    briefing: {
      name: "Eagle Wreck",
      locationName: "Islamorada, Florida",
      forecastLatitude: 24.87,
      forecastLongitude: -80.5702,
      description:
        "A 87 m freighter sunk in 1985 and broken into two clean sections by Hurricane Georges — which made it a better dive: two open halves, both swimmable, both full of fish.",
      marineLife: "Goliath grouper · barracuda · jacks · glassy sweepers",
      marineLifeDescription:
        "The broken ends are the best of it — open, lit, and thick with schooling fish holding out of the current.",
      difficultyLevel: "advanced",
      depthRange: "20–34 m (65–110 ft)",
      maxDepthMeters: 34,
      currentNote: "Open water, and often a real current — a line dive when it is running.",
      divePlan:
        "Descend the mooring to the shallower section, work the length of one half, and turn on gas rather than on time.",
      fitTone: "demanding",
      fitNote:
        "Deep, exposed and worth nitrox. Two dives here is the honest way to see the whole ship.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The break",
          kind: "wreckFeature",
          note: "Where the hurricane split her. The open cross-section is the most photographed thing on the wreck.",
        },
        {
          name: "Wheelhouse and mast",
          kind: "wreckFeature",
          note: "The shallowest structure at about 20 m, and where a lot of the fish life sits.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "glassy-sweeper",
        "spotted-moray",
        "yellow-tube-sponge",
      ],
    },
  },
  {
    slug: "cheeca-rocks",
    version: 1,
    briefing: {
      name: "Cheeca Rocks",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.8975,
      forecastLongitude: -80.6183,
      description:
        "A patch reef inshore of the reef line, in barely 6 m of water — and, unusually for the Keys, one whose coral has been *gaining* cover. A sanctuary preservation area, and a snorkel site as much as a dive.",
      marineLife: "Brain coral · star coral · parrotfish · yellowtail snapper",
      marineLifeDescription:
        "Big mounding coral heads with unusually good live cover; the fish life is dense because the structure is.",
      difficultyLevel: "beginner",
      depthRange: "2–6 m (6–20 ft)",
      maxDepthMeters: 6,
      currentNote: "Inshore and sheltered — the reliable call when the outer reef is unworkable.",
      divePlan:
        "A slow circuit of the patch heads; at this depth the tank outlasts anyone's patience.",
      fitTone: "welcoming",
      fitNote:
        "Barely deeper than a pool, and the best coral cover a beginner will see in the Keys.",
      landmarks: [
        {
          name: "The mounding heads",
          kind: "reefFormation",
          note: "Boulder corals metres across, each one its own small city.",
        },
      ],
      creatureSlugs: [
        "great-star-coral",
        "grooved-brain-coral",
        "stoplight-parrotfish",
        "yellowtail-snapper",
        "foureye-butterflyfish",
        "flamingo-tongue",
      ],
    },
  },

  // ─── Marathon and the Middle Keys ─────────────────────────────────────────
  {
    slug: "sombrero-reef",
    version: 1,
    briefing: {
      name: "Sombrero Reef",
      locationName: "Marathon, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.6279,
      forecastLongitude: -81.1116,
      description:
        "Marathon's signature reef, under a 43 m 1858 lighthouse. Long coral fingers with arches and swim-throughs cut into them, in water shallow enough to spend an hour in.",
      marineLife: "Parrotfish · angelfish · tarpon · nurse sharks",
      marineLifeDescription:
        "The arches hold fish out of the light all day. Look through them rather than over them.",
      difficultyLevel: "beginner",
      depthRange: "3–9 m (10–30 ft)",
      maxDepthMeters: 9,
      currentNote: "Usually mild; a sanctuary preservation area, so mooring buoys only.",
      divePlan:
        "Follow one spur out to the sand, cross the groove, and come back along the next — the arches are on the outer third.",
      fitTone: "welcoming",
      fitNote: "Shallow, structured and photogenic. One tank goes a long way at 6 m.",
      landmarks: [
        {
          name: "Sombrero Key Light",
          kind: "navigationMark",
          note: "The tallest of the Keys reef lights, standing directly over the site.",
        },
        {
          name: "The arch",
          kind: "reefFormation",
          note: "A natural coral arch big enough to swim through, on the seaward side of the reef.",
        },
      ],
      creatureSlugs: [
        "queen-parrotfish",
        "french-angelfish",
        "tarpon",
        "nurse-shark",
        "banded-butterflyfish",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "thunderbolt-wreck",
    version: 1,
    briefing: {
      name: "Thunderbolt",
      locationName: "Marathon, Florida",
      forecastLatitude: 24.6567,
      forecastLongitude: -80.945,
      description:
        "A 57 m cable-laying research vessel sunk upright in 1986, with an enormous cable spool still standing on the bow. Intact, well proportioned, and the wreck most Middle Keys divers cut their teeth on.",
      marineLife: "Goliath grouper · barracuda · amberjack · black coral",
      marineLifeDescription:
        "Resident goliath grouper hold in the superstructure; the deeper steel is furred with hydroids and black coral.",
      difficultyLevel: "advanced",
      depthRange: "23–37 m (75–120 ft)",
      maxDepthMeters: 37,
      currentNote:
        "Open water on the Gulf Stream side — current is the usual reason a day is called.",
      divePlan:
        "Down the mooring to the wheelhouse, forward along the deck to the cable spool, and back up the line with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "Upright, tidy and deep. A very good first deep wreck for a diver with the card for it, ideally on nitrox.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The cable spool",
          kind: "wreckFeature",
          note: "A drum three metres across standing on the bow — the picture everyone takes.",
        },
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "Open and intact at about 27 m, usually with a grouper in residence.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "schoolmaster-snapper",
        "spotted-moray",
        "red-rope-sponge",
      ],
    },
  },
  {
    slug: "coffins-patch",
    version: 1,
    briefing: {
      name: "Coffins Patch",
      locationName: "Marathon, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.6803,
      forecastLongitude: -80.9583,
      description:
        "Six separate patch reefs strung along a shallow line, including one of the few remaining pillar-coral stands in the Keys. A different mooring is a different dive.",
      marineLife: "Pillar coral · sea fans · butterflyfish · spiny lobster",
      marineLifeDescription:
        "The pillar-coral patch is the one to ask for — furry spires standing off the bottom, feeding in daylight.",
      difficultyLevel: "beginner",
      depthRange: "3–9 m (10–30 ft)",
      maxDepthMeters: 9,
      currentNote: "Sheltered inside the reef line and usually calm.",
      divePlan:
        "One patch per dive. Circle it once wide for the shape, once close for what lives in it.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, calm, and the best chance in the Keys of seeing pillar coral before it is gone.",
      landmarks: [
        {
          name: "The pillar coral stand",
          kind: "reefFormation",
          note: "Rare and slow-growing. Hover well clear — the polyps are out feeding by day, which almost no other coral does.",
        },
      ],
      creatureSlugs: [
        "pillar-coral",
        "common-sea-fan",
        "spotfin-butterflyfish",
        "spiny-lobster",
        "smooth-trunkfish",
        "banded-coral-shrimp",
      ],
    },
  },

  // ─── Lower Keys ───────────────────────────────────────────────────────────
  {
    slug: "looe-key-reef",
    version: 1,
    briefing: {
      name: "Looe Key Reef",
      locationName: "Big Pine Key, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.5486,
      forecastLongitude: -81.4058,
      description:
        "The Lower Keys' best reef: a textbook spur-and-groove system named for a British frigate lost here in 1744, with coral fingers running seaward into deep sand grooves.",
      marineLife: "Parrotfish · goatfish · nurse sharks · barracuda",
      marineLifeDescription:
        "The grooves funnel fish. The deeper seaward end of each spur is where the big schools sit.",
      difficultyLevel: "beginner",
      depthRange: "3–11 m (10–35 ft)",
      maxDepthMeters: 11,
      currentNote: "Sanctuary preservation area — mooring buoys only, and usually a mild current.",
      divePlan:
        "Out along a spur to the seaward end, across a groove, and back along the next one to the shallow fore reef.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and easy, with enough structure that experienced divers do not get bored either.",
      landmarks: [
        {
          name: "The seaward spur ends",
          kind: "reefFormation",
          note: "Where the coral fingers drop into sand at about 11 m, and where the fish stack up.",
        },
        {
          name: "HMS Looe ballast",
          kind: "reefHistory",
          note: "Ballast stone from the 1744 wreck lies scattered inshore of the reef — ask the crew if the mooring is near it.",
        },
      ],
      creatureSlugs: [
        "stoplight-parrotfish",
        "nurse-shark",
        "great-barracuda",
        "french-grunt",
        "hogfish",
        "elkhorn-coral",
      ],
    },
  },
  {
    slug: "adolphus-busch",
    version: 1,
    briefing: {
      name: "Adolphus Busch Sr.",
      locationName: "Looe Key, Florida",
      forecastLatitude: 24.53,
      forecastLongitude: -81.465,
      description:
        "A 64 m freighter sunk in 1998 and sitting upright on the sand, small enough to see properly in one dive and shallow enough at the superstructure to spend real time on.",
      marineLife: "Goliath grouper · jewfish · barracuda · glassy sweepers",
      marineLifeDescription:
        "Several very large goliath grouper live aboard. They are used to divers and entirely unbothered.",
      difficultyLevel: "advanced",
      depthRange: "20–33 m (65–110 ft)",
      maxDepthMeters: 33,
      currentNote: "Open water; current decides whether it is a line dive or a free descent.",
      divePlan:
        "Down the line to the wheelhouse at about 24 m, one lap of the exterior, and back up on gas.",
      fitTone: "demanding",
      fitNote:
        "Deep, but compact and upright — one of the friendlier deep wrecks once the card is there.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "Open and intact, and usually where the resident grouper is.",
        },
        {
          name: "Bow rails",
          kind: "wreckFeature",
          note: "Still standing, still square — the ship looks like a ship from here.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "glassy-sweeper",
        "great-barracuda",
        "schoolmaster-snapper",
        "green-moray",
        "giant-barrel-sponge",
      ],
    },
  },

  // ─── Key West ─────────────────────────────────────────────────────────────
  {
    slug: "usns-vandenberg",
    version: 1,
    briefing: {
      name: "USNS Vandenberg",
      locationName: "Key West, Florida",
      forecastLatitude: 24.45,
      forecastLongitude: -81.7333,
      description:
        "A 159 m missile-tracking ship sunk in 2009, upright in 43 m with her two enormous parabolic dish antennas still mounted. The second-largest artificial reef in the world, and it feels like it.",
      marineLife: "Goliath grouper · permit · barracuda · amberjack",
      marineLifeDescription:
        "Permit meet you on the way down. The superstructure carries dense schooling fish, and the dishes are usually surrounded.",
      difficultyLevel: "advanced",
      depthRange: "12–43 m (40–140 ft)",
      maxDepthMeters: 43,
      currentNote:
        "Seven miles offshore in open water — current is common and the crew calls the line and the drop.",
      divePlan:
        "Down the line to the superstructure, one section only — the mast, a dish, or the bridge — and back to the line. Nobody sees this ship in one dive.",
      fitTone: "demanding",
      fitNote:
        "Big, deep, and easy to over-run. Nitrox, a plan for one section, and a hard turn on gas.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The satellite dishes",
          kind: "wreckFeature",
          note: "Ten metres across and mounted fore and aft. The reason this wreck looks like nothing else.",
        },
        {
          name: "The crow's nest",
          kind: "wreckFeature",
          note: "The shallowest steel at about 12 m — where a long safety stop becomes a pleasure.",
        },
        {
          name: "Bridge deck",
          kind: "wreckFeature",
          note: "Open and swimmable at about 27 m, with the whole ship visible fore and aft on a clear day.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "permit-fish",
        "great-barracuda",
        "horse-eye-jack",
        "cobia",
        "azure-vase-sponge",
      ],
    },
  },
  {
    slug: "sand-key-reef",
    version: 1,
    briefing: {
      name: "Sand Key Reef",
      locationName: "Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.4539,
      forecastLongitude: -81.8775,
      description:
        "A shallow reef around an 1853 iron lighthouse and its shifting sand island. Sheltered on one side, exposed on the other, so there is nearly always a workable face.",
      marineLife: "Parrotfish · yellowtail snapper · sea fans · barracuda",
      marineLifeDescription:
        "Dense soft coral on the seaward face, and a permanent cloud of yellowtail wherever a boat has been.",
      difficultyLevel: "beginner",
      depthRange: "3–14 m (10–45 ft)",
      maxDepthMeters: 14,
      currentNote: "Pick the lee side of the light and the day is usually easy.",
      divePlan:
        "Circle out from the mooring along the reef edge and back — the deeper sand is worth a look for rays.",
      fitTone: "welcoming",
      fitNote: "Shallow, close to town, and workable in most conditions.",
      landmarks: [
        {
          name: "Sand Key Light",
          kind: "navigationMark",
          note: "The iron tower on its own small island — the reference for the whole site.",
        },
      ],
      creatureSlugs: [
        "yellowtail-snapper",
        "queen-parrotfish",
        "common-sea-fan",
        "great-barracuda",
        "southern-stingray",
        "sea-plume",
      ],
    },
  },
  {
    slug: "western-dry-rocks",
    version: 1,
    briefing: {
      name: "Western Dry Rocks",
      locationName: "Key West, Florida",
      forecastLatitude: 24.4467,
      forecastLongitude: -81.9283,
      description:
        "A cut-and-cave reef west of Key West, riddled with ledges and tunnels, and a known spawning aggregation site — which is why it is closed to fishing in spring and why the fish life is what it is.",
      marineLife: "Goliath grouper · permit · tarpon · nurse sharks",
      marineLifeDescription:
        "The ledges hold big fish through the day, and in spring the aggregations here are extraordinary.",
      difficultyLevel: "intermediate",
      depthRange: "6–20 m (20–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Tidal current runs through the cuts and can be strong — often dived as a drift.",
      divePlan:
        "Work the ledge line with the current, look into every cut, and finish on the shallow reef top.",
      fitTone: "demanding",
      fitNote:
        "Current and structure together — comfortable in a drift, and happy to swim away from a hole rather than into it.",
      landmarks: [
        {
          name: "The caves",
          kind: "reefFormation",
          note: "Undercut ledges rather than true caves, and no place to go in past your light.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "permit-fish",
        "tarpon",
        "nurse-shark",
        "spiny-lobster",
        "blackbar-soldierfish",
      ],
    },
  },

  // ─── South-east Florida: Palm Beach to Miami ──────────────────────────────
  {
    slug: "blue-heron-bridge",
    version: 1,
    briefing: {
      name: "Blue Heron Bridge",
      locationName: "Phil Foster Park, Riviera Beach, Florida",
      forecastLatitude: 26.7841,
      forecastLongitude: -80.0428,
      description:
        "A shore dive in a shallow lagoon under a road bridge, and one of the best muck-diving sites in the world. Nothing here is big. Everything here is strange.",
      marineLife: "Frogfish · seahorses · octopus · batfish · nudibranchs",
      marineLifeDescription:
        "Sand, rubble, pilings and snorkel trail. The find of the dive is usually two centimetres long and pretending to be a leaf.",
      difficultyLevel: "beginner",
      depthRange: "1–6 m (4–20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "Dive it in the hour either side of high tide. Outside that window the current is unswimmable and the visibility goes.",
      divePlan:
        "Enter from the beach, work the snorkel trail and the piling bases slowly, and turn on time rather than gas — nobody runs out of air at 4 m.",
      fitTone: "welcoming",
      fitNote:
        "Shallow enough for anyone, but it rewards a diver who can hover still over sand for ten minutes without touching it.",
      fieldGuideTipsHeading: "Everything good here is small",
      landmarks: [
        {
          name: "The snorkel trail",
          kind: "pointOfInterest",
          note: "Sunk sculptures and modules along the east lagoon — a reef built for exactly this.",
        },
        {
          name: "Bridge pilings",
          kind: "pointOfInterest",
          note: "Every piling is its own vertical reef. Work them one at a time.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-octopus",
        "peacock-flounder",
        "yellowhead-jawfish",
        "banded-coral-shrimp",
        "arrow-crab",
        "spotted-scorpionfish",
      ],
    },
  },
  {
    slug: "breakers-reef",
    version: 1,
    briefing: {
      name: "Breakers Reef",
      locationName: "Palm Beach, Florida",
      forecastLatitude: 26.705,
      forecastLongitude: -80.0217,
      description:
        "Palm Beach's home reef, dived as a drift in the Gulf Stream: ledges and coral heads sliding past while you do almost nothing. Turtles are close to guaranteed.",
      marineLife: "Green turtles · goliath grouper · angelfish · spotted eagle rays",
      marineLifeDescription:
        "The ledges hold turtles and grouper; eagle rays and big pelagics come through the blue side.",
      difficultyLevel: "intermediate",
      depthRange: "12–20 m (40–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Always a drift — the Gulf Stream runs one to two knots here and the boat follows the bubbles.",
      divePlan:
        "Negative entry, group up on the bottom, and let the current do the work. Surface together with an SMB up.",
      fitTone: "demanding",
      fitNote:
        "Easy water once you accept you are not swimming anywhere. A drift briefing and an SMB are the whole skill set.",
      landmarks: [
        {
          name: "The ledge line",
          kind: "reefFormation",
          note: "A continuous undercut running north — stay on the inshore edge and you stay with the group.",
        },
      ],
      creatureSlugs: [
        "green-sea-turtle",
        "goliath-grouper",
        "queen-angelfish",
        "spotted-eagle-ray",
        "hogfish",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "jupiter-goliath-ledges",
    version: 1,
    briefing: {
      name: "Jupiter Ledges",
      locationName: "Jupiter, Florida",
      forecastLatitude: 26.9433,
      forecastLongitude: -80.03,
      description:
        "Deep drift diving over limestone ledges off Jupiter — the site of the summer goliath grouper aggregation, when a hundred fish the size of armchairs gather in one place.",
      marineLife: "Goliath grouper · lemon sharks · bull sharks · amberjack",
      marineLifeDescription:
        "Late summer is the aggregation. The rest of the year it is a big-animal drift: sharks, jacks, and turtles on the ledges.",
      difficultyLevel: "advanced",
      depthRange: "21–29 m (70–95 ft)",
      maxDepthMeters: 29,
      currentNote: "Strong Gulf Stream drift, always. Negative entries and a fast group-up.",
      divePlan:
        "Negative entry to the ledge, drift the line with the group, and shoot an SMB before you leave the bottom.",
      fitTone: "demanding",
      fitNote:
        "Deep, fast water with big animals in it. Comfortable with a negative entry, an SMB, and being told where to be.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The aggregation ledge",
          kind: "reefFormation",
          note: "An undercut that fills with goliath grouper from August into September. Hover off it; do not swim into it.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "lemon-shark",
        "caribbean-reef-shark",
        "horse-eye-jack",
        "green-sea-turtle",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "lady-luck-shipwreck-park",
    version: 1,
    briefing: {
      name: "Lady Luck",
      locationName: "Shipwreck Park, Pompano Beach, Florida",
      forecastLatitude: 26.2422,
      forecastLongitude: -80.07,
      description:
        "A 99 m tanker sunk in 2016 and decorated as an underwater art park — a card table, a croupier, and a poker theme running the length of her deck at about 24 m.",
      marineLife: "Barracuda · goliath grouper · amberjack · sea turtles",
      marineLifeDescription:
        "Young enough that the growth is still coming in, but the fish arrived immediately.",
      difficultyLevel: "advanced",
      depthRange: "18–37 m (60–120 ft)",
      maxDepthMeters: 37,
      currentNote: "Gulf Stream current is common; usually dived with a line and a live boat.",
      divePlan:
        "Down the line to the deck, work the sculptures fore to aft, and back to the line on gas — the sand at 37 m is not the dive.",
      fitTone: "demanding",
      fitNote:
        "Deep and current-swept, but the interesting half is the deck at 24 m rather than the bottom.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The card table",
          kind: "wreckFeature",
          note: "A full-size poker scene bolted to the deck, croupier included.",
        },
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "The shallowest structure at about 18 m, and a natural place to end the tour.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "goliath-grouper",
        "horse-eye-jack",
        "green-sea-turtle",
        "spanish-hogfish",
        "yellow-tube-sponge",
      ],
    },
  },
  {
    slug: "copenhagen-wreck",
    version: 1,
    briefing: {
      name: "SS Copenhagen",
      locationName: "Lauderdale-by-the-Sea, Florida",
      forecastLatitude: 26.19,
      forecastLongitude: -80.085,
      description:
        "A 100 m steamship that ran onto the reef in 1900 and has been flattening into it ever since. A protected state archaeological site, in 5–9 m — snorkellable, and the easiest wreck in south Florida.",
      marineLife: "Sergeant majors · parrotfish · barracuda · spiny lobster",
      marineLifeDescription:
        "A century of growth over iron plate. The wreck is now mostly reef with a ship's outline still in it.",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (15–30 ft)",
      maxDepthMeters: 9,
      currentNote: "Shallow and close in; surge matters more than current here.",
      divePlan:
        "Follow the hull outline from the boilers out along the plating, then loop back over the reef either side.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, protected, and an easy first wreck. Nothing may be taken — this is a state archaeological preserve.",
      landmarks: [
        {
          name: "The boilers",
          kind: "wreckFeature",
          note: "The most recognisable ironwork left, standing proud of the reef.",
        },
        {
          name: "Hull plating",
          kind: "wreckFeature",
          note: "Flattened sheets marking the ship's outline. Swim the shape and you can still read her.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "stoplight-parrotfish",
        "great-barracuda",
        "spiny-lobster",
        "porkfish",
        "fire-coral",
      ],
    },
  },
  {
    slug: "neptune-memorial-reef",
    version: 1,
    briefing: {
      name: "Neptune Memorial Reef",
      locationName: "Key Biscayne, Miami, Florida",
      forecastLatitude: 25.6902,
      forecastLongitude: -80.0908,
      description:
        "An underwater columned city in 12 m of sand off Miami — a cremation memorial built as an artificial reef, with gates, lions and columns colonising fast.",
      marineLife: "Angelfish · barracuda · sponges · sea fans",
      marineLifeDescription:
        "Purpose-built structure on open sand, which means everything that lives here chose to come.",
      difficultyLevel: "beginner",
      depthRange: "12 m (40 ft)",
      maxDepthMeters: 14,
      currentNote: "Open water off Miami; a mild drift is common.",
      divePlan:
        "One circuit of the structure with the current, then back through the middle — the whole site fits in a dive.",
      fitTone: "welcoming",
      fitNote:
        "Flat, shallow and easy. It is also a memorial, and divers are asked to treat it as one.",
      landmarks: [
        {
          name: "The gates and lions",
          kind: "underwaterMonument",
          note: "The entrance to the memorial, and the picture the site is known for.",
        },
        {
          name: "The columns",
          kind: "underwaterMonument",
          note: "Standing pillars carrying placed remains. Look, and keep your hands to yourself.",
        },
      ],
      creatureSlugs: [
        "gray-angelfish",
        "great-barracuda",
        "yellow-tube-sponge",
        "common-sea-fan",
        "porkfish",
        "spanish-hogfish",
      ],
    },
  },

  // ─── The Panhandle and the Gulf ───────────────────────────────────────────
  {
    slug: "uss-oriskany",
    version: 1,
    briefing: {
      name: "USS Oriskany",
      locationName: "Pensacola, Florida",
      forecastLatitude: 30.0425,
      forecastLongitude: -87.0064,
      description:
        "An aircraft carrier — 275 m of her — sunk in 2006 and standing upright in 65 m of Gulf water. The flight deck is at 44 m and the island tower tops out around 24 m. The largest artificial reef in the world.",
      marineLife: "Amberjack · barracuda · red snapper · whale sharks (rarely)",
      marineLifeDescription:
        "Pelagic. The tower holds bait balls and the amberjack that work them; the open Gulf brings everything else.",
      difficultyLevel: "advanced",
      depthRange: "24–44 m (80–145 ft) for recreational depths",
      maxDepthMeters: 44,
      currentNote:
        "Open Gulf, 22 miles out. Current, visibility and the boat ride all decide the day together.",
      divePlan:
        "The island tower only, on a recreational dive: down the line to about 24–30 m, one section of the superstructure, and back up the line. The flight deck is a technical dive.",
      fitTone: "demanding",
      fitNote:
        "This is the deepest thing most recreational divers will ever do, on a long open-Gulf ride. Nitrox, a conservative plan, and a hard turn pressure.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The island tower",
          kind: "wreckFeature",
          note: "The superstructure, from about 24 m down. The whole recreational dive happens here.",
        },
        {
          name: "The flight deck",
          kind: "wreckFeature",
          note: "At 44 m and beyond recreational limits for most plans — look down at it, not from it.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "cobia",
        "gray-snapper",
        "remora",
        "red-rope-sponge",
      ],
    },
  },
  {
    slug: "vamar-wreck",
    version: 1,
    briefing: {
      name: "Vamar Wreck",
      locationName: "Panama City, Florida",
      forecastLatitude: 29.95,
      forecastLongitude: -85.6167,
      description:
        "A 52 m steamer that carried Admiral Byrd's 1928 Antarctic expedition, capsized off Panama City in 1942 and now a protected state underwater archaeological preserve in 8 m of sand.",
      marineLife: "Sheepshead · flounder · octopus · sea urchins",
      marineLifeDescription:
        "Gulf life rather than reef life — the wreck is an island of structure on an otherwise empty sand plain.",
      difficultyLevel: "beginner",
      depthRange: "8 m (25 ft)",
      maxDepthMeters: 9,
      currentNote: "Shallow and usually calm; Gulf visibility is the variable, not the current.",
      divePlan:
        "Follow the hull line, look under every plate, and give the whole tank to a wreck the size of a tennis court.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and forgiving. A protected preserve — nothing comes off it, including the small stuff.",
      landmarks: [
        {
          name: "The boiler",
          kind: "wreckFeature",
          note: "The highest point on the wreck and the first thing to find on the descent.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-octopus",
        "peacock-flounder",
        "sand-diver",
        "long-spined-urchin",
        "gray-snapper",
        "spotted-scorpionfish",
      ],
    },
  },

  // ─── Freshwater: the springs ──────────────────────────────────────────────
  {
    slug: "devils-den",
    version: 1,
    briefing: {
      name: "Devil's Den",
      locationName: "Williston, Florida",
      forecastLatitude: 29.407,
      forecastLongitude: -82.4762,
      description:
        "A spring inside a collapsed limestone karst dome, entered down a staircase through a hole in the ground. Water at 22 °C all year, and shafts of light coming through the opening above.",
      marineLife: "Freshwater — no marine life",
      marineLifeDescription:
        "Nothing swims here to speak of. The dive is the light, the rock, and the fossil beds in the walls.",
      difficultyLevel: "beginner",
      depthRange: "5–16 m (15–54 ft)",
      maxDepthMeters: 16,
      currentNote: "No current. Confined and calm; the only variable is how many divers are in it.",
      divePlan:
        "Circle the basin at depth, then come up into the light column and spend the end of the dive shallow under the opening.",
      fitTone: "welcoming",
      fitNote:
        "Warm, still, and enclosed — the training site half of north Florida certified in. Overhead is limited to the open dome; there is no cave diving here without cave training.",
      fieldGuideTipsHeading: "Look at the rock, not for fish",
      landmarks: [
        {
          name: "The light column",
          kind: "pointOfInterest",
          note: "Sun through the hole in the roof, best in the middle of the day. The reason people come.",
        },
        {
          name: "Fossil beds",
          kind: "pointOfInterest",
          note: "Pleistocene bone has come out of this basin. What is left in the walls stays in the walls.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "blue-grotto",
    version: 1,
    briefing: {
      name: "Blue Grotto",
      locationName: "Williston, Florida",
      forecastLatitude: 29.3879,
      forecastLongitude: -82.4857,
      description:
        "North Florida's largest clear-water cavern dive: a basin dropping to 30 m with a guideline through the cavern zone and an air bell partway down, at 22 °C year round.",
      marineLife: "Freshwater — turtles and a resident eel",
      marineLifeDescription:
        "Softshell turtles, bream, and Virgil the resident eel, who has been here longer than most of the instructors.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "No current at all. Depth and the overhead are what the plan is about.",
      divePlan:
        "Down the basin wall to the platform, along the guideline within the cavern zone only, and back up with light in hand.",
      fitTone: "demanding",
      fitNote:
        "Clear and calm, but it is deep and it is overhead. Stay inside the daylight zone and on the line unless you hold a cavern or cave card.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The air bell",
          kind: "pointOfInterest",
          note: "A pocket of breathable air partway down the cavern. A curiosity, not an exit.",
        },
        {
          name: "The guideline",
          kind: "navigationMark",
          note: "Follow it, keep it in sight, and turn where it says. That is the whole rule here.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "ginnie-springs",
    version: 1,
    briefing: {
      name: "Ginnie Springs",
      locationName: "High Springs, Florida",
      forecastLatitude: 29.836,
      forecastLongitude: -82.7,
      description:
        "Gin-clear spring water flowing into the tannic Santa Fe River, with the Ginnie Ballroom — a genuinely large open cavern — at the head of it. 22 °C all year.",
      marineLife: "Freshwater — gar, bream, turtles",
      marineLifeDescription:
        "Longnose gar hang in the halocline where the clear spring meets the dark river water. Worth the wait.",
      difficultyLevel: "beginner",
      depthRange: "4–16 m (12–54 ft)",
      maxDepthMeters: 16,
      currentNote:
        "Spring outflow pushes against you on the way in and carries you out. The river outside can be a different colour entirely.",
      divePlan:
        "Into the Ballroom against the flow, one circuit inside the daylight zone, and let the spring run push you back out to the basin.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, warm and astonishingly clear. The Ballroom is grated beyond the cavern — everything past that grate needs cave training.",
      landmarks: [
        {
          name: "The Ballroom",
          kind: "pointOfInterest",
          note: "A cavern big enough to lose a group in, lit all the way through from the entrance.",
        },
        {
          name: "The halocline at the river",
          kind: "pointOfInterest",
          note: "Where the clear spring run meets tea-coloured river water. Swim through it slowly.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "morrison-springs",
    version: 1,
    briefing: {
      name: "Morrison Springs",
      locationName: "Walton County, Florida",
      forecastLatitude: 30.6577,
      forecastLongitude: -85.9046,
      description:
        "A wide, public, first-magnitude spring basin in a cypress swamp, with a 15 m cavern at the bottom and a boardwalk to the water. Free to dive, and busy for it.",
      marineLife: "Freshwater — bass, bream, turtles",
      marineLifeDescription:
        "Largemouth bass hang at the edge of the clear water where it meets the swamp.",
      difficultyLevel: "beginner",
      depthRange: "3–15 m (10–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Gentle outflow. Visibility drops fast after heavy rain when the swamp pushes back in.",
      divePlan:
        "Down the basin, a look at the cavern entrance from outside it, and a slow shallow circuit under the cypress.",
      fitTone: "welcoming",
      fitNote:
        "Easy, shallow, and a genuinely lovely place to be. The cavern is for cavern-trained divers only.",
      landmarks: [
        {
          name: "The cavern entrance",
          kind: "pointOfInterest",
          note: "Three openings at the base of the basin. Look in from the daylight; do not go in without the card.",
        },
      ],
      creatureSlugs: [],
    },
  },
  {
    slug: "three-sisters-springs",
    version: 1,
    briefing: {
      name: "Three Sisters Springs",
      locationName: "Crystal River, Florida",
      forecastLatitude: 28.89,
      forecastLongitude: -82.5894,
      description:
        "Warm spring water in the Crystal River refuge, and the winter gathering place for West Indian manatees — a snorkel site, not a scuba site, and a strictly regulated one.",
      marineLife: "Manatees · mullet · blue crabs",
      marineLifeDescription:
        "Hundreds of manatees come in when the Gulf drops below 20 °C. Passive observation only, by federal rule.",
      difficultyLevel: "beginner",
      depthRange: "1–5 m (3–16 ft)",
      maxDepthMeters: 5,
      currentNote:
        "Gentle spring flow. In-water access is closed on manatee-crowded days — check the refuge before the boat leaves.",
      divePlan:
        "Snorkel only. Float still at the surface, hands to yourself, and let the animals decide what happens next.",
      fitTone: "welcoming",
      fitNote:
        "Anyone who can float can do this. What it demands is discipline: no touching, no chasing, no diving down.",
      fieldGuideTipsHeading: "Stay still and let them come",
      landmarks: [
        {
          name: "The spring vents",
          kind: "pointOfInterest",
          note: "Where the warm water comes up — and therefore where the animals are.",
        },
      ],
      creatureSlugs: ["manatee"],
    },
  },
  {
    slug: "rainbow-river",
    version: 1,
    briefing: {
      name: "Rainbow River",
      locationName: "Dunnellon, Florida",
      forecastLatitude: 29.1029,
      forecastLongitude: -82.435,
      description:
        "A first-magnitude spring run dived as a slow downstream drift over white sand and eelgrass, in 22 °C water clear enough to read the bottom from a boat.",
      marineLife: "Freshwater — turtles, gar, bass, otters",
      marineLifeDescription:
        "Softshell turtles work the grass beds, and the sand boils where the spring vents push up through the bottom.",
      difficultyLevel: "beginner",
      depthRange: "2–7 m (6–23 ft)",
      maxDepthMeters: 7,
      currentNote:
        "A steady downstream drift. Swim back up and you will regret it — this is a one-way dive.",
      divePlan:
        "Drop at the head spring and drift down with the flow, staying off the eelgrass, to the pick-up point.",
      fitTone: "welcoming",
      fitNote:
        "Warm, shallow, effortless. Ideal for a first drift and for anyone who wants an hour of doing nothing beautifully.",
      landmarks: [
        {
          name: "The sand boils",
          kind: "pointOfInterest",
          note: "Spring vents pushing up through white sand, boiling it like water in a pan.",
        },
        {
          name: "The eelgrass beds",
          kind: "pointOfInterest",
          note: "Hover above them. A fin-print in a grass bed lasts for months.",
        },
      ],
      creatureSlugs: ["turtle-grass"],
    },
  },
];
