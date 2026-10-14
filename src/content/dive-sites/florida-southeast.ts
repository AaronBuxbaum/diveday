// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** South-east Florida: Palm Beach to Miami. */
export const FLORIDA_SOUTHEAST: DiveSiteTemplate[] = [
  {
    slug: "blue-heron-bridge",
    version: 2,
    area: "florida-southeast",
    sources: [
      "https://www.tdisdi.com/sdi-diver-news/diving-the-blue-heron-bridge/",
      "https://discover.pbcgov.org/parks/locations/phil-foster.aspx",
      "https://dan.org/alert-diver/article/blue-heron-bridge/",
    ],
    briefing: {
      name: "Blue Heron Bridge",
      locationName: "Phil Foster Park, Riviera Beach, Florida",
      forecastLatitude: 26.7841,
      forecastLongitude: -80.0428,
      description:
        "A shore dive in a shallow lagoon under a road bridge, and one of the best muck-diving sites in the world. Nothing here is big. Everything here is strange.",
      marineLife: "Frogfish · seahorses · octopus · batfish · nudibranchs",
      marineLifeDescription:
        "Sand, rubble, pilings and snorkel trail. The find of the dive is usually two centimeters long and pretending to be a leaf.",
      difficultyLevel: "beginner",
      depthRange: "1–6 m (4–20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "Dive it within about half an hour of slack high tide. Outside that window the current is unswimmable and the visibility goes. Tow a dive flag, which Florida law requires, and stay in the swim area west of the channel markers: the Intracoastal next to it is a boat lane.",
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
          note: "Limestone boulders and reef modules in 2 to 3 m, just south of the park beach. Concrete hammerhead statues sit at the west end.",
        },
        {
          name: "Bridge pilings",
          kind: "pointOfInterest",
          note: "Every piling is its own vertical reef. Work them one at a time.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-octopus",
        "longlure-frogfish",
        "longsnout-seahorse",
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
    version: 2,
    area: "florida-southeast",
    sources: [
      "https://discover.pbcgov.org/erm/Pages/Reefs.aspx",
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
    ],
    briefing: {
      name: "Breakers Reef",
      locationName: "Palm Beach, Florida",
      forecastLatitude: 26.7149,
      forecastLongitude: -80.0303,
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
    version: 2,
    area: "florida-southeast",
    sources: [
      "https://www.underwaterjournal.com/jupiters-underwater-world-of-giants/",
      "https://sarahsekula.com/gentle-giants-goliath-grouper-in-florida-attract-divers-from-around-the-world/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M/V%20Zion%20Train%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Jupiter Wreck Trek",
      locationName: "Jupiter, Florida",
      forecastLatitude: 26.963,
      forecastLongitude: -80.0073,
      description:
        "Three wrecks sunk close together off Jupiter: the Zion Train, the Esso Bonaire and the Miss Jenny, on sand at about 27 m. From late August into September, goliath grouper gather on them to spawn, dozens at a time.",
      marineLife: "Goliath grouper · lemon sharks · amberjack · sea turtles",
      marineLifeDescription:
        "Late summer is the aggregation. The rest of the year it is a big-animal drift: sharks, jacks, and turtles on the wrecks.",
      difficultyLevel: "advanced",
      depthRange: "17–27 m (55–90 ft)",
      maxDepthMeters: 27,
      currentNote: "Strong Gulf Stream drift, always. Negative entries and a fast group-up.",
      divePlan:
        "Negative entry onto the first wreck, drift from one to the next with the group, and shoot an SMB before you leave the bottom.",
      fitTone: "demanding",
      fitNote:
        "Deep, fast water with big animals in it. Comfortable with a negative entry, an SMB, and being told where to be.",
      // Advanced Open Water for the drift, not the depth: a negative entry into
      // a fast Gulf Stream current, at 27 m. Deep adds nothing above 30 m.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wrecks",
          kind: "wreckFeature",
          note: "Three hulls within about 150 m of each other. In the spawning season the grouper hang over and around them. Hover off; do not swim into the group.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "lemon-shark",
        "horse-eye-jack",
        "green-sea-turtle",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "lady-luck-shipwreck-park",
    version: 2,
    area: "florida-southeast",
    sources: [
      "https://www.wptv.com/news/state/new-artificial-reef-sunk-off-pompano-beach",
      "https://divernet.com/scuba-diving/lady-luck-set-to-have-her-day/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Lady%20Luck%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Lady Luck",
      locationName: "Shipwreck Park, Pompano Beach, Florida",
      forecastLatitude: 26.2301,
      forecastLongitude: -80.0634,
      description:
        "A 99 m tanker sunk in 2016 and decorated as an underwater art park — a card table, a croupier, and a poker theme running the length of her deck at about 24 m.",
      marineLife: "Barracuda · goliath grouper · amberjack · sea turtles",
      marineLifeDescription:
        "Young enough that the growth is still coming in, but the fish arrived immediately.",
      difficultyLevel: "advanced",
      depthRange: "18–40 m (60–130 ft)",
      maxDepthMeters: 40,
      currentNote: "Gulf Stream current is common; usually dived with a line and a live boat.",
      divePlan:
        "Down the line to the deck, work the sculptures fore to aft, and back to the line on gas. The sand at 40 m is not the dive.",
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
    version: 2,
    area: "florida-southeast",
    sources: [
      "https://www.nps.gov/articles/sscopenhagen.htm",
      "https://lauderdalebythesea-fl.gov/DocumentCenter/View/262",
      "https://en.wikipedia.org/wiki/SS_Copenhagen_(1898)",
    ],
    briefing: {
      name: "SS Copenhagen",
      locationName: "Lauderdale-by-the-Sea, Florida",
      forecastLatitude: 26.2058,
      forecastLongitude: -80.0851,
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
          note: "The most recognizable ironwork left, standing proud of the reef.",
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
    version: 2,
    area: "florida-southeast",
    sources: [
      "https://nmreef.com/overview/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Neptune%20Memorial%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Neptune Memorial Reef",
      locationName: "Miami, Florida",
      forecastLatitude: 25.7006,
      forecastLongitude: -80.0902,
      description:
        "An underwater columned city in 12 m of sand off Miami — a cremation memorial built as an artificial reef, with gates, lions and columns colonizing fast.",
      marineLife: "Angelfish · barracuda · sponges · sea fans",
      marineLifeDescription:
        "Purpose-built structure on open sand, which means everything that lives here chose to come.",
      difficultyLevel: "beginner",
      depthRange: "12–14 m (40–45 ft)",
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
];
