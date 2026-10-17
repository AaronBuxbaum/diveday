// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Bimini. */
export const BAHAMAS_BIMINI: DiveSiteTemplate[] = [
  // Denominator row: Sapona (S.S. Sapona)
  {
    slug: "sapona-wreck-bimini",
    version: 1,
    area: "bahamas-bimini",
    sources: [
      "https://www.bahamas.com/natural-wonders/sapona-shipwreck",
      "https://biggameclubbimini.com/diving-adventure/favorite-dive-sites/",
      "https://www.wannadive.net/spot/Central_America/Bahamas/Bimini_Islands/Sapona_Wreck/index.html",
      "https://geoffschultz.org/Log_Page.php?subjectid=Bimini+Dive+Sites",
      "https://en.wikipedia.org/wiki/SS_Sapona",
    ],
    briefing: {
      name: "SS Sapona",
      locationName: "South Bimini, Bimini Islands",
      // Position: wannadive 25.6513, -79.2936 and a 2007 GPS log 25.6513, -79.2936; Wikipedia and
      // OpenStreetMap list 25.6507, -79.2932, within 100 m.
      forecastLatitude: 25.6513,
      forecastLongitude: -79.2936,
      description:
        "A concrete ship from the First World War era, grounded by a 1926 hurricane and later used for target practice. She sits half out of the water in about 5 m, a landmark for boats and a popular snorkel. Most of the concrete has worn away, so her inner workings show, with fish packed around them.",
      marineLife: "Nurse sharks · grunts · blackbar soldierfish",
      marineLifeDescription:
        "Grunts and soldierfish school around the hull. Nurse sharks rest under the stern, so give them room.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 6,
      currentNote:
        "Boats use the wreck as a mark and people jump from the deck, so listen for engines, look up before you surface and carry an SMB. Current is reported as low, under 1 knot.",
      divePlan:
        "Swim a slow circle outside the hull and look under the stern from a distance. Do not touch or crowd the sharks. Stay outside the hull; the worn concrete leaves the inside unsafe. Surface away from the hull: rebar shows where the concrete has worn away, and people jump from the deck.",
      fitTone: "welcoming",
      fitNote:
        "Very shallow and clear from the surface. The boat ride, a few miles from the harbor, is the longer part.",
      landmarks: [
        {
          name: "The hull",
          kind: "wreckFeature",
          note: "Half exposed and mostly bare of concrete. Stay outside the hull.",
        },
        {
          name: "Navigation landmark",
          kind: "navigationMark",
          note: "Boaters use the wreck to steer by, so expect traffic around it.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "french-grunt",
        "blackbar-soldierfish",
        "yellowtail-snapper",
        "sergeant-major",
      ],
    },
  },
  // Denominator row: Bimini Road (Atlantis Road)
  {
    slug: "bimini-road",
    version: 1,
    area: "bahamas-bimini",
    sources: [
      "https://www.bahamas.com/natural-wonders/bimini-road",
      "https://biggameclubbimini.com/diving-adventure/favorite-dive-sites/",
      "https://www.wannadive.net/spot/Central_America/Bahamas/Bimini_Islands/Atlantis_Road/index.html",
      "https://geoffschultz.org/Log_Page.php?subjectid=Bimini+Dive+Sites",
      "https://en.wikipedia.org/wiki/Bimini_Road",
    ],
    briefing: {
      name: "Bimini Road",
      locationName: "North Bimini, Bimini Islands",
      // Position: a 2007 GPS log 25.7666, -79.2785, wannadive 25.7667, -79.2786 and Wikipedia
      // 25.7670, -79.2788 all agree within 50 m. Depth: the log says 15 ft, Wikipedia 5.5 m,
      // wannadive 7 m average and 8 m maximum.
      forecastLatitude: 25.7667,
      forecastLongitude: -79.2786,
      description:
        "Two rows of large squared stones, about 450 m (1,500 ft) long, in shallow water west of North Bimini. Geologists who drilled them found natural beachrock, and the idea that they are an ancient road is a popular legend. A shallow, easy dive either way.",
      marineLife: "Sea fans · spiny lobster · sergeant majors · wrasses",
      marineLifeDescription:
        "Fish shelter in the gaps between the blocks, and sea fans stand on the stones.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 9,
      currentNote:
        "Current is reported as low, under 1 knot. A regular stop for dive and snorkel charters, so listen for engines and carry an SMB.",
      divePlan:
        "Follow one row of blocks for its length, cross to the other, and return along it. Shallow enough to stay down for the whole tank.",
      fitTone: "welcoming",
      fitNote: "Shallow and quiet, and a good dive for a first day in Bimini.",
      landmarks: [
        {
          name: "The two rows of stones",
          kind: "pointOfInterest",
          note: "Two nearly parallel lines of large rectangular blocks, about 450 m long.",
        },
      ],
      creatureSlugs: ["common-sea-fan", "spiny-lobster", "sergeant-major", "bluehead-wrasse"],
    },
  },
  // Denominator row: The Strip
  {
    slug: "the-strip-bimini",
    version: 1,
    area: "bahamas-bimini",
    sources: [
      "https://biggameclubbimini.com/diving-adventure/favorite-dive-sites/",
      "https://geoffschultz.org/Log_Page.php?subjectid=Bimini+Dive+Sites",
      "https://www.wannadive.net/spot/Central_America/Bahamas/Bimini_Islands/The_Strip/index.html",
    ],
    briefing: {
      name: "The Strip",
      locationName: "North Bimini, Bimini Islands",
      // Approximate pin: the 2007 GPS log lists the reef as "The Line" at 25.7367, -79.3027 and
      // places it just north of the channel between South and North Bimini; wannadive's page
      // gives "The Line" as the Strip's other name and the same place in words ("north of the
      // channel ... not far from Alice Town harbour"). Its own point, 1.9 km south, sits on the
      // South Bimini shore and contradicts that text, so it was not used.
      forecastLatitude: 25.7367,
      forecastLongitude: -79.3027,
      description:
        "A thin reef line about 90 m (100 yards) long and barely 5 m wide, standing 3 m high on open sand. Everything lives on it, which makes it a busy dive by day or night.",
      marineLife: "Reef octopus · spotted moray · spiny lobster · nurse sharks",
      marineLifeDescription:
        "Octopus, morays and lobsters work the coral heads. Nurse sharks and southern stingrays rest on the sand around it.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 13,
      currentNote:
        "Boat traffic from the Alice Town harbor is listed as a hazard here: listen for engines and carry an SMB. Current is reported as low, under 1 knot.",
      divePlan:
        "Swim the length of the reef at one depth, return along the other side, and finish over the sand. Watch the animals from a distance; do not touch or follow them.",
      fitTone: "welcoming",
      fitNote: "Compact and shallow. It rewards slow swimming and a tank's worth of looking.",
      landmarks: [
        {
          name: "The reef line",
          kind: "reefFormation",
          note: "A narrow ridge of coral heads about 90 m long, with sand on both sides.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-octopus",
        "spotted-moray",
        "spiny-lobster",
        "nurse-shark",
        "southern-stingray",
        "peacock-flounder",
      ],
    },
  },
  // Denominator row: Moray Alley
  {
    slug: "moray-alley-bimini",
    version: 1,
    area: "bahamas-bimini",
    sources: [
      "https://biggameclubbimini.com/diving-adventure/favorite-dive-sites/",
      "https://geoffschultz.org/Log_Page.php?subjectid=Bimini+Dive+Sites",
      "https://www.wannadive.net/spot/Central_America/Bahamas/Bimini_Islands/Moray_Alley/index.html",
    ],
    briefing: {
      name: "Moray Alley",
      locationName: "North Bimini, Bimini Islands",
      // Position: the 2007 GPS log's mooring, 25.7499, -79.3066. wannadive lists 25.7418, -79.3107,
      // 0.95 km away. Depth: the log and the Big Game Club give 50–75 ft; wannadive's maximum of 24 m is used.
      forecastLatitude: 25.7499,
      forecastLongitude: -79.3066,
      description:
        "A reef off North Bimini named for the green morays that have long lived in it. Yellowtail snapper, Nassau grouper, trumpetfish and grunts live on it, with blue tangs swarming the reef and black durgons in midwater.",
      marineLife: "Green moray · yellowtail snapper · Nassau grouper · southern stingrays",
      marineLifeDescription:
        "Morays live in the reef; do not feed, touch or corner them. Snappers, groupers and schooling grunts are residents, and stingrays turn up on the sand.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 25,
      currentNote: "Current is reported as low, under 1 knot. Open water, so carry an SMB.",
      divePlan:
        "Descend with the group onto the reef, work along it at one depth, and ascend slowly with reserve gas. Do not feed, touch or corner the morays.",
      fitTone: "unknown",
      fitNote:
        "No part of the site is shallower than 15 m (50 ft). Open Water divers stay in the upper part, no deeper than 18 m.",
      creatureSlugs: [
        "green-moray",
        "yellowtail-snapper",
        "nassau-grouper",
        "trumpetfish",
        "blue-tang",
        "southern-stingray",
      ],
    },
  },
  // Denominator row: Victory Reef (Tuna Alley, The Nodules)
  {
    slug: "victory-reef-bimini",
    version: 1,
    area: "bahamas-bimini",
    sources: [
      "https://biggameclubbimini.com/diving-adventure/favorite-dive-sites/",
      "https://geoffschultz.org/Log_Page.php?subjectid=Bimini+Dive+Sites",
      "https://www.westgateresorts.com/es/blog/bucear-en-bimini-bahamas/",
    ],
    briefing: {
      name: "Victory Reef",
      locationName: "Southern cays, Bimini Islands",
      // Approximate pin: the middle Victory Reef mooring in the 2007 GPS log (25.4818, -79.2703).
      // The Big Game Club puts the Victory Reef stretch south of Cat Cay along the Bimini Cays; there
      // is no second GPS listing, so the pin is good to about 2 km along that stretch. The wall slopes to about 120 ft then drops steeply; the plan holds a 30 m floor,
      // and the Gulf Stream current and the drop gate the site at Advanced Open Water.
      // Treated as a drift: the source calls the current strong, so the plan is a drift with an SMB ascent.
      forecastLatitude: 25.4818,
      forecastLongitude: -79.2703,
      description:
        "A long reef line on the edge of the Great Bahama Bank, with sloping wall, ridges and terraces that were once shorelines. The slope runs from about 15 m to a second ridge near 21 m, then steps down and falls away past recreational depth into the Straits of Florida. Tuna Alley, next door, is named for the spring migration of bluefin tuna.",
      marineLife: "Sea fans · sponges · bluefin tuna (spring) · reef fish",
      marineLifeDescription:
        "The slope is thick with coral and sponge. Bluefin tuna pass in spring.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Currents can be strong off the wall: a Bimini guide rates Victory Reef advanced for them, and the Gulf Stream runs close. Carry an SMB and make the safety stop on it in open water; the boat picks the group up.",
      divePlan:
        "Descend to the slope at about 15 m and drift along the wall no deeper than 30 m, then ascend on an SMB with reserve gas and wait for the boat to pick the group up. Overheads on the wall; stay out. Staff confirm the diver’s log before boarding.",
      // The wall falls past 30 m; the plan holds a hard floor at 30 m, and the Gulf Stream drift
      // gates it at Advanced Open Water without the Deep specialty.
      fitTone: "demanding",
      fitNote:
        "A drift along an edge that does not end where you should stop. For divers comfortable with both. Medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The slope and ridges",
          kind: "reefFormation",
          note: "Terraces that mark old shorelines, stepping down from about 15 m.",
        },
      ],
      creatureSlugs: ["common-sea-fan", "giant-barrel-sponge", "queen-angelfish", "blue-tang"],
    },
  },
];
