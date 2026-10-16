// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** St Vincent and the Grenadines. */
export const ST_VINCENT_GRENADINES: DiveSiteTemplate[] = [
  {
    slug: "puruni-wreck",
    version: 1,
    area: "st-vincent-grenadines",
    sources: [
      "https://tourism.gov.vc/tourism/index.php/diving-a-watersports/63-dive-sites",
      "https://grenadinesdive.com/ScubaDiving.html",
      "https://www.mandarinoriental.com/en/canouan/caribbean/explore/scuba-diving",
      "https://discoversvg.com/what-to-do/diving-snorkelling/",
    ],
    briefing: {
      // Approximate pin: off Mayreau (all four sources say only 'off Mayreau'); placed in the water off the island's west coast, geocoded island 12.6397,-61.3897 via OpenStreetMap Nominatim. Good to about 2 km.
      name: "Puruni Wreck",
      locationName: "Mayreau, St Vincent and the Grenadines",
      forecastLatitude: 12.64,
      forecastLongitude: -61.3995,
      description:
        "A 1918 British gunship, about 43 m (140 ft) long, lying in 12 m of water off Mayreau. Now an artificial reef, shallow enough to be a first wreck.",
      marineLife: "Reef fish · sponges · soft corals",
      marineLifeDescription:
        "Growth covers the hull, and reef fish use it as shelter. Look at the outside plating and the fish around it.",
      difficultyLevel: "beginner",
      depthRange: "12 m (40 ft)",
      maxDepthMeters: 12,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Drop to the sand beside the hull, circle the wreck once at a slow pace, and finish on the shallow side with reserve gas. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and small enough to circle twice. Stay outside the hull, whatever your card.",
      creatureSlugs: [
        "sergeant-major",
        "french-grunt",
        "bluehead-wrasse",
        "blue-tang",
        "queen-angelfish",
      ],
    },
  },
  {
    slug: "horseshoe-reef-tobago-cays",
    version: 1,
    area: "st-vincent-grenadines",
    sources: [
      "https://tourism.gov.vc/tourism/index.php/diving-a-watersports/63-dive-sites",
      "https://grenadinesdive.com/ScubaDiving.html",
      "https://discoversvg.com/?p=736",
      "https://en.wikipedia.org/wiki/Tobago_Cays",
    ],
    briefing: {
      // Traffic and the Open Water limit follow the domain review; the sources do not document either, so the conservative reading is written. Approximate pin: Horseshoe Reef is a 4 km bank barrier reef east of Baradal, Petit Rameau and Petit Bateau (discoversvg.com/?p=736, Wikipedia); pinned in the water about 450 m east of Baradal (geocoded 12.6342,-61.3549, OpenStreetMap Nominatim). Good to about 2 km. Depth 60 ft from the operator list; the outer drop-off is deeper, so 18 m is the plan's floor.
      name: "Horseshoe Reef",
      locationName: "Tobago Cays Marine Park, St Vincent and the Grenadines",
      forecastLatitude: 12.634,
      forecastLongitude: -61.351,
      description:
        "A long barrier reef that shelters four of the five Tobago Cays. Inside it the water is shallow and calm; outside, the reef falls off into deeper water, and the plan stays well above that.",
      marineLife: "Green turtles · nurse sharks · soft corals · sea fans",
      marineLifeDescription:
        "Hard and soft corals cover the reef, and nurse sharks and sand sharks rest under the ledges. Turtles graze the shallows.",
      conservationNote:
        "Inside Tobago Cays Marine Park, which charges a park fee. On a dive trip it is usually included in the price, so confirm with the crew. Touch and take nothing.",
      difficultyLevel: "intermediate",
      depthRange: "18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Boat and snorkeler traffic in the Cays: ascend on the line or an SMB. Current not documented; ask the crew on the day. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Inside the reef, on its sheltered side, is the usual dive. Staff confirm the diver's card before boarding for the outer edge, at no more than 18 m (60 ft). Keep clear of the ledges where sharks rest, and finish shallow with reserve gas.",
      fitTone: "welcoming",
      fitNote: "Gentle inside the reef, with a deeper edge outside that the plan does not use.",
      creatureSlugs: [
        "green-sea-turtle",
        "nurse-shark",
        "common-sea-fan",
        "sea-plume",
        "bluehead-wrasse",
      ],
    },
  },
  {
    slug: "mopion-reef",
    version: 1,
    area: "st-vincent-grenadines",
    sources: [
      "https://tourism.gov.vc/tourism/index.php/diving-a-watersports/63-dive-sites",
      "https://grenadinesdive.com/ScubaDiving.html",
    ],
    briefing: {
      // Approximate pin: Mopion is an islet off Petit St Vincent (geocoded 12.5464,-61.3953 via OpenStreetMap Nominatim); the reef is pinned in the water about 150 m east of the islet. Good to about 2 km. Depth: the operator gives an average of about 50 ft, so 15 m is the plan's depth and the max; no source gives a deepest figure. Gate: a drift of undocumented strength, so Advanced Open Water, as at Mayreau Gardens.
      name: "Mopion Reef",
      locationName: "Petit St Vincent, St Vincent and the Grenadines",
      forecastLatitude: 12.5464,
      forecastLongitude: -61.3935,
      description:
        "A reef off Petit St Vincent beside Mopion, a tiny sand islet. It runs at about 15 m (50 ft) on average and is dived as a drift.",
      marineLife: "Caribbean reef sharks · nurse sharks · spiny lobster · moray eels",
      marineLifeDescription:
        "Sharks rest on the sand between the coral heads and big lobsters and morays sit in the reef. Sightings are not promised.",
      difficultyLevel: "advanced",
      depthRange: "About 15 m (50 ft) on average",
      maxDepthMeters: 15,
      currentNote:
        "Run as a drift; strength and direction are not documented, so carry an SMB. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Drift along the reef at about 15 m, the depth the operator gives, and do a safety stop on your SMB line. Staff confirm the diver can deploy an SMB before boarding. If sharks are resting on the sand, stay put and give them room: nothing dangling, no chasing or touching, group together and follow the crew's briefing.",
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "unknown",
      fitNote:
        "A drift past resting sharks. Bring your own SMB and the habit of keeping your distance.",
      creatureSlugs: [
        "caribbean-reef-shark",
        "nurse-shark",
        "spiny-lobster",
        "green-moray",
        "hawksbill-turtle",
      ],
    },
  },
  {
    slug: "mayreau-gardens",
    version: 1,
    area: "st-vincent-grenadines",
    sources: [
      "https://tourism.gov.vc/tourism/index.php/diving-a-watersports/63-dive-sites",
      "https://grenadinesdive.com/ScubaDiving.html",
      "https://discoversvg.com/what-to-do/diving-snorkelling/",
      "https://en.wikipedia.org/wiki/Tobago_Cays",
    ],
    briefing: {
      // Approximate pin: the reef lies off Mayreau (all sources); pinned in the water about 700 m east of the Mayreau lookout (geocoded 12.6399,-61.3826, OpenStreetMap Nominatim). Good to about 2 km. Depth: 55 ft drifting north, 80 ft drifting south (operator list); the deeper figure sets the max.
      name: "Mayreau Gardens",
      locationName: "Mayreau, St Vincent and the Grenadines",
      forecastLatitude: 12.6385,
      forecastLongitude: -61.376,
      description:
        "A broad coral reef off Mayreau, dived as a drift. Crinoids, garden eels and flamingo tongues are common.",
      marineLife: "Garden eels · flamingo tongues · crinoids · sea fans",
      marineLifeDescription:
        "Look low in the sand for garden eels and on the sea fans for flamingo tongues. Crinoids perch on the high points.",
      difficultyLevel: "intermediate",
      depthRange: "17–24 m (55–80 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Run as a drift whose direction follows the current: about 17 m (55 ft) going north, about 24 m (80 ft) going south. Strength is not documented, so carry an SMB. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Drift with the current from the shallower end, hold the depth the crew sets for the direction that day, and finish with a safety stop on your SMB line.",
      fitTone: "demanding",
      fitNote: "A drift whose depth depends on which way the water runs, from 17 m to 24 m.",
      // Advanced Open Water because the drift runs at 17-24 m with undocumented strength, so no Open Water turn at 18 m can be set in advance.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "garden-eel",
        "flamingo-tongue",
        "golden-crinoid",
        "common-sea-fan",
        "spotted-trunkfish",
      ],
    },
  },
  {
    slug: "petit-tabac-reef",
    version: 1,
    area: "st-vincent-grenadines",
    sources: [
      "https://grenadinesdive.com/ScubaDiving.html",
      "https://discoversvg.com/?p=736",
      "https://en.wikipedia.org/wiki/Tobago_Cays",
      "https://www.mandarinoriental.com/en/canouan/caribbean/explore/scuba-diving",
    ],
    briefing: {
      // Approximate pin: the reef off Petit Tabac, a cay just outside the Tobago Cays main reef (discoversvg.com/?p=736, Wikipedia); pinned in the water about 250 m east of the islet (geocoded 12.6233,-61.3492, OpenStreetMap Nominatim). Good to about 2 km. Depth: maximum 45 ft from the operator list.
      name: "Petit Tabac Reef",
      locationName: "Tobago Cays Marine Park, St Vincent and the Grenadines",
      forecastLatitude: 12.6225,
      forecastLongitude: -61.3455,
      description:
        "The reef off Petit Tabac, the cay that sits just outside the main Tobago Cays reef. Shallow, with a maximum of about 14 m (45 ft), and used for resort courses.",
      marineLife: "Reef fish · sea fans · parrotfish · turtles",
      marineLifeDescription:
        "A healthy reef in a marine park, with reef fish over the coral and turtles passing through the Cays.",
      conservationNote:
        "Inside Tobago Cays Marine Park, which charges a park fee. On a dive trip it is usually included in the price, so confirm with the crew. Touch and take nothing.",
      difficultyLevel: "beginner",
      depthRange: "14 m (45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Boat and snorkeler traffic in the Cays: ascend on the line or an SMB. Current not documented; ask the crew on the day.",
      divePlan:
        "A relaxed loop along the reef at the depth your group is certified for, with a safety stop and reserve gas before surfacing.",
      fitTone: "welcoming",
      fitNote: "Shallow enough for a first ocean dive and a calm place to practice slow looking.",
      creatureSlugs: [
        "green-sea-turtle",
        "queen-parrotfish",
        "common-sea-fan",
        "blue-tang",
        "bluehead-wrasse",
      ],
    },
  },
  {
    slug: "ends-reef-tobago-cays",
    version: 1,
    area: "st-vincent-grenadines",
    sources: [
      "https://grenadinesdive.com/ScubaDiving.html",
      "https://discoversvg.com/what-to-do/diving-snorkelling/",
      "https://discoversvg.com/?p=736",
    ],
    briefing: {
      // Approximate pin: End's Reef is listed among the Tobago Cays sites (discoversvg.com, the operator list); discoversvg.com/?p=736 puts World's End Reef beyond Petit Tabac. Pinned in the water about 800 m east of Petit Tabac (geocoded 12.6233,-61.3492, OpenStreetMap Nominatim) and well clear of the Petit Tabac pin. Good to about 2 km. Depth: 70 ft from the operator list; one other article gives 35 m for this reef (it also appears under a Sail Rock heading); where sources disagree the deeper is taken, so the plan runs to 35 m with Advanced Open Water and Deep.
      name: "Ends Reef",
      locationName: "Tobago Cays Marine Park, St Vincent and the Grenadines",
      forecastLatitude: 12.6215,
      forecastLongitude: -61.342,
      description:
        "A reef at the outer edge of the Tobago Cays, with stingrays resting in the sand and spotted eagle rays flying past in formation.",
      marineLife: "Stingrays · spotted eagle rays · reef fish",
      marineLifeDescription:
        "Rays rest on the sand beside the coral, and eagle rays pass in groups. Neither is a promise.",
      conservationNote:
        "Inside Tobago Cays Marine Park, which charges a park fee. On a dive trip it is usually included in the price, so confirm with the crew. Touch and take nothing.",
      difficultyLevel: "advanced",
      depthRange: "21–35 m (70–115 ft)",
      maxDepthMeters: 35,
      currentNote:
        "Boat and snorkeler traffic in the Cays: ascend on the line or an SMB. Current not documented; ask the crew on the day. It sits at the outer edge of the Cays, so carry an SMB. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Follow the reef at the depth the crew sets, no deeper than 35 m (115 ft), and finish with a safety stop and reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "An outer-reef dive in a marine park, deeper than the sheltered sites inside.",
      // Advanced Open Water and Deep: the deepest source figure is 35 m, and the site is at the outer edge of the Cays.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "southern-stingray",
        "spotted-eagle-ray",
        "bluehead-wrasse",
        "common-sea-fan",
        "queen-parrotfish",
      ],
    },
  },
  {
    slug: "pinese-reef-petit-st-vincent",
    version: 1,
    area: "st-vincent-grenadines",
    sources: [
      "https://grenadinesdive.com/ScubaDiving.html",
      "https://discoversvg.com/what-to-do/diving-snorkelling/",
    ],
    briefing: {
      // Approximate pin: both sources list Pinese (Pineese) Reef under Petit St Vincent; pinned in the water about 600 m west of the island's resort (geocoded 12.5364,-61.3839, OpenStreetMap Nominatim). Good to about 2 km. Depth: slopes to about 65 ft from the operator list.
      name: "Pinese Reef",
      locationName: "Petit St Vincent, St Vincent and the Grenadines",
      forecastLatitude: 12.535,
      forecastLongitude: -61.3895,
      description:
        "A reef off Petit St Vincent that slopes to about 20 m (65 ft), with a mooring on it. Spotted drums move through the coral, and lobsters sit in the cracks.",
      marineLife: "Spotted drums · spiny lobster · reef fish",
      marineLifeDescription:
        "Spotted drums hover under the ledges, and lobsters tuck into the cracks in the slope.",
      difficultyLevel: "intermediate",
      depthRange: "20 m (65 ft)",
      maxDepthMeters: 20,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, along the slope no deeper than 20 m (65 ft), and back up the line for a safety stop with reserve gas.",
      fitTone: "welcoming",
      fitNote: "A mooring and a gentle slope; a quiet dive off a small island.",
      creatureSlugs: [
        "spotted-drum",
        "spiny-lobster",
        "french-grunt",
        "bluehead-wrasse",
        "common-sea-fan",
      ],
    },
  },
];
