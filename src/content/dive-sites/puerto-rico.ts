// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Puerto Rico. */
export const PUERTO_RICO: DiveSiteTemplate[] = [
  // Denominator row: Crash Boat (Aguadilla)
  {
    slug: "crash-boat-aguadilla",
    version: 1,
    area: "puerto-rico",
    sources: [
      "https://web.archive.org/web/2026/https://www.discoverpuertorico.com/article/scuba-diving-novice-to-advanced",
      "https://www.wannadive.net/spot/Central_America/Puerto_Rico/West_coast_and_Mona_island/Crash_Boat_Piers/index.html",
    ],
    briefing: {
      name: "Crash Boat",
      locationName: "Crash Boat Beach, Aguadilla",
      // Approximate pin: wannadive 18.4572, -67.1650 and OpenStreetMap's beach point 18.4578, -67.1636,
      // within 200 m. A shore dive: the point is the pier at the beach. Depth: wannadive gives 9 m
      // average and 24.4 m maximum past the piers; the plan stays among the structures.
      forecastLatitude: 18.4575,
      forecastLongitude: -67.1645,
      description:
        "A shore dive from a busy beach, under and around an old navy pier. The pilings and a few free-standing piers are covered in sea life, with turtles and plenty of small fish.",
      marineLife: "Sergeant majors · angelfish · trumpetfish · sea turtles",
      marineLifeDescription:
        "Fish shelter under the pier. Sea turtles, octopus and squid turn up now and then.",
      difficultyLevel: "intermediate",
      depthRange: "0–24 m (0–80 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Boat traffic is listed as a hazard here: keep close to the pilings, carry an SMB and listen for engines. Current is reported as low, under 1 knot. Surf and a rip can run at the entry; check them from the beach before you kit up. Do not swim under the pier decks or the collapsed pier.",
      divePlan:
        "Enter from the beach, follow the main pier out and look along the pilings and free-standing piers, then return the same way. The plan floor is 24 m (80 ft), the deepest point reported past the piers; most of the dive is shallower, and the structures are the reason to be here. Do not swim under the pier decks or the collapsed pier.",
      fitTone: "unknown",
      fitNote:
        "A shore entry through possible surf, with boat traffic overhead. A dive for divers who have done a beach entry before.",
      landmarks: [
        {
          name: "Main pier",
          kind: "pointOfInterest",
          note: "An old navy pier running out from the beach; the pilings are covered in sea life.",
        },
        {
          name: "Free-standing piers",
          kind: "pointOfInterest",
          note: "Square piers on either side of the main one, with fish under them. A collapsed one lies submerged to the right.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "french-angelfish",
        "trumpetfish",
        "green-sea-turtle",
        "caribbean-reef-octopus",
        "queen-triggerfish",
      ],
    },
  },
  // Denominator row: Desecheo Island (boat dives)
  {
    slug: "desecheo-island",
    version: 1,
    area: "puerto-rico",
    sources: [
      "https://web.archive.org/web/2026/https://www.discoverpuertorico.com/article/scuba-diving-novice-to-advanced",
      "https://www.wannadive.net/spot/Central_America/Puerto_Rico/West_coast_and_Mona_island/Desecheo/index.html",
      "https://en.wikipedia.org/wiki/Desecheo_Island",
    ],
    briefing: {
      name: "Desecheo Island",
      locationName: "Desecheo National Wildlife Refuge, off Rincón",
      // Approximate pin: wannadive's Desecheo reef point (18.3767, -67.4830), 0.9 km from
      // OpenStreetMap's point for the island (18.3839, -67.4810); the island is about 12 miles west
      // of Rincón. Depth: wannadive 18.3 m average and 27.4 m (90 ft) maximum.
      forecastLatitude: 18.3767,
      forecastLongitude: -67.483,
      description:
        "A small uninhabited island about 12 miles out, with reef all around it and water that often clears past 30 m. Diving around the island is allowed. The island itself is closed to the public.",
      marineLife: "Reef fish · crustaceans · turtles · sharks",
      marineLifeDescription:
        "Healthy reef with a wide cast: fish, lobsters and turtles, with sharks and dolphins reported. Humpback whales pass in winter, sometimes heard underwater.",
      difficultyLevel: "advanced",
      depthRange: "18–27 m (60–90 ft)",
      maxDepthMeters: 28,
      currentNote: "Current not documented; ask the crew on the day. Open water: carry an SMB.",
      divePlan:
        "Descend with the group onto the reef and work along it at one depth, no deeper than 27 m (90 ft). Ascend with reserve gas, with an SMB up. Never land on the island; unexploded military ordnance makes it off limits. Do not touch or move any metal object; report it to the crew.",
      // Gate: Advanced Open Water because this is open sea 12 miles out in the Mona Passage with
      // current not documented, and the sources rate it for veteran divers.
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "demanding",
      fitNote:
        "A boat trip about 12 miles out, so the weather decides. Medical care is far; confirm the boat’s oxygen and plan.",
      landmarks: [
        {
          name: "Desecheo Island",
          kind: "navigationMark",
          note: "A small island, closed to landing; dive around it from the boat only.",
        },
      ],
      creatureSlugs: [
        "green-sea-turtle",
        "hawksbill-turtle",
        "spiny-lobster",
        "bluehead-wrasse",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: La Parguera Wall
  {
    slug: "la-parguera-wall",
    version: 1,
    area: "puerto-rico",
    sources: [
      "https://www.lapargueralajas.com/west-divers-1",
      "https://www.paradisescubasnorkelingpr.com/scuba-diving-trips/wall-dive-la-parguera/",
      "https://www.wannadive.net/spot/Central_America/Puerto_Rico/West_coast_and_Mona_island/Parguera_s_Wall/index.html",
      "https://web.archive.org/web/2026/https://www.discoverpuertorico.com/article/scuba-diving-novice-to-advanced",
    ],
    briefing: {
      name: "La Parguera Wall",
      locationName: "La Parguera, Lajas",
      // Approximate pin: wannadive's wall point (17.8783, -67.0621). It lies 6.7 km (4.1 mi) from the
      // nearest land, the cays off La Parguera, which sits between wannadive's own "3 miles from the
      // coast" and West Divers' "5 miles off the coast of Lajas". The wall runs along the shelf with
      // more than 30 sites, so the pin is a forecast point on that stretch, not a mooring.
      // Depth: West Divers has the top at 55-65 ft and a vertical drop to about 130 ft; Paradise
      // Scuba dives 60-120 ft; wannadive gives 28 m average and 36 m maximum.
      // The wall steps down and then falls away past recreational depth; the plan holds a 30 m
      // floor, which gates the site at Advanced Open Water.
      forecastLatitude: 17.8783,
      forecastLongitude: -67.0621,
      description:
        "A long wall that the shelf drops into a few miles south of La Parguera. The top lies between about 17 and 20 m, with trenches, elkhorn, gorgonians and black coral, and visibility often past 30 m. The wall steps down and then falls away, far past the plan’s floor.",
      marineLife: "Gorgonians · black coral · barracuda · reef fish",
      marineLifeDescription:
        "Sponges and gorgonians crowd the wall, and the water column holds medium-sized fish with the odd barracuda.",
      difficultyLevel: "advanced",
      depthRange: "17–30 m (55–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current is reported as low, under 1 knot, but this is open sea and the wall is run as a boat dive: carry an SMB and follow the crew’s plan.",
      divePlan:
        "Descend to the lip of the wall, follow it no deeper than 30 m, and ascend with reserve gas and an SMB up. The wall is vertical past 30 m; hold 30 m. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A wall dive over deep water, with a boat ride out. For divers who hold depth comfortably. Medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "The shelf edge, with trenches, elkhorn coral and gorgonians along its top.",
        },
      ],
      creatureSlugs: [
        "black-coral",
        "common-sea-fan",
        "elkhorn-coral",
        "great-barracuda",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Mosquito Pier (Vieques)
  {
    slug: "mosquito-pier-vieques",
    version: 1,
    area: "puerto-rico",
    sources: [
      "https://www.blackbeardsports.com/fun-dives-vieques",
      "https://web.archive.org/web/2026/https://www.discoverpuertorico.com/article/scuba-diving-novice-to-advanced",
      "https://www.wannadive.net/spot/Central_America/Puerto_Rico/Vieques_island/Rompe_Olas/index.html",
    ],
    briefing: {
      name: "Mosquito Pier",
      locationName: "North shore, Vieques",
      // Approximate pin: wannadive's "Rompe Olas" 18.1488, -65.5143 (the breakwater's other name in
      // the tourism guide) and OpenStreetMap's pier point 18.1491, -65.5154, within 120 m. A shore
      // dive: the point is the pier. wannadive's 45 m maximum (25 m average) disagrees with Black
      // Beard Sports (the shop that runs the dive) and wannadive's own diver comment, both 40 ft. The
      // operator's figure is kept because no source describes a deeper part of the pier itself, and
      // the plan holds 12 m; if a shop finds the pier's end deeper, it raises the depth and the gate.
      forecastLatitude: 18.149,
      forecastLongitude: -65.5148,
      description:
        "A former military pier and breakwater on the north shore, with a shore entry and sheltered water. Turtles, rays, lobsters, eels, octopus and tarpon use it, with a nurse shark now and then.",
      marineLife: "Hawksbill turtles · eagle rays · tarpon · nurse sharks",
      marineLifeDescription:
        "Hawksbill and green turtles live along the pilings. Rays, morays and lobsters sit under the structure.",
      difficultyLevel: "beginner",
      depthRange: "0–12 m (0–40 ft)",
      maxDepthMeters: 13,
      currentNote:
        "Sheltered; current is reported as low. Visibility can be soft. Entry surface not documented; ask the crew about the shore entry and exit. Nets are listed as a hazard, so keep clear of any line or net.",
      divePlan:
        "Enter from the shore, follow the pier out along its pilings, and return the same way. Turn at half your gas, not at the end of the pier, and hold 12 m (40 ft). Keep to the structure and stay out of open water. Former military site: touch no metal object and report it to the crew.",
      fitTone: "welcoming",
      fitNote: "A shore entry with sheltered water and turtles, to 12 m (40 ft).",
      landmarks: [
        {
          name: "The pier",
          kind: "pointOfInterest",
          note: "A former military pier and breakwater about a mile long on the north shore.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "tarpon",
        "nurse-shark",
        "spiny-lobster",
      ],
    },
  },
];
