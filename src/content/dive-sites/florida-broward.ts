// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Broward County: Hillsboro Inlet to Port Everglades and Hollywood. */
export const FLORIDA_BROWARD: DiveSiteTemplate[] = [
  {
    slug: "lady-luck-shipwreck-park",
    version: 2,
    area: "florida-broward",
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
    area: "florida-broward",
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
  // Pompano Drop-Off (The Balls)
  {
    slug: "pompano-drop-off",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://www.floridagofishing.com/_pdf/reefs-broward-gps-mooring-buoys.pdf",
      "https://www.southfloridadiving.com/dive-sites/recreational/pompano-drop-off/",
      "https://seaxp.com/south-florida-reefs/",
      "https://www.parrotislandscuba.com/reef.php",
    ],
    briefing: {
      name: "Pompano Drop-Off",
      locationName: "off Pompano Beach and Lauderdale-by-the-Sea, Florida",
      forecastLatitude: 26.2116,
      forecastLongitude: -80.0846,
      description:
        "A long, shallow limestone ridge just off the beach, marked by a line of county mooring buoys that locals simply call the Balls. Its east-facing ledge is crowded with small reef life, and the Nursery and the Copenhagen wreck both sit along it.",
      marineLife: "Grunts · sailfin blennies · yellowhead jawfish · nurse sharks · spiny lobster",
      marineLifeDescription:
        "The ledge holds schooling grunts and lobster; the sand behind it is where to look for jawfish and blennies.",
      difficultyLevel: "beginner",
      depthRange: "4–9 m (12–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Usually little or no current and shallow enough for snorkellers, so it is a common training and second dive. Tow a dive flag, which Florida law requires, and stay close to it: the reef is close to shore and boat traffic over it is steady.",
      divePlan:
        "Drop on any buoy and follow the eastern ledge north or south, then cut west over the holes and staghorn patches on the way back.",
      fitTone: "welcoming",
      fitNote: "Shallow, calm and busy with fish. A good first ocean dive.",
      landmarks: [
        {
          name: "The eastern ledge",
          kind: "reefFormation",
          note: "The main ledge, facing offshore and running parallel to the beach. Follow it and you cannot get lost.",
        },
        {
          name: "The Nursery",
          kind: "pointOfInterest",
          note: "A stretch of deep undercut ledge where a group of nurse sharks rests. Watch them from outside the overhang; do not reach in.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "bluestriped-grunt",
        "sailfin-blenny",
        "yellowhead-jawfish",
        "spiny-lobster",
        "staghorn-coral",
      ],
    },
  },
  // Suzanne's Ledge
  {
    slug: "suzannes-ledge",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://www.southfloridadiving.com/dive-sites/recreational/suzzanes-ledge/",
    ],
    briefing: {
      name: "Suzanne's Ledge",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.2288,
      forecastLongitude: -80.0826,
      description:
        "The northern run of the same nearshore ridge as the Pompano Drop-Off, buoyed since 2008. An east-facing ledge full of juvenile fish and bait, with patches of staghorn coral on its landward side.",
      marineLife: "Juvenile reef fish · baitfish schools · tarpon · staghorn coral",
      marineLifeDescription:
        "A nursery reef: small fish everywhere, and now and then a tarpon working the bait.",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (15–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Usually little current. Close to shore and under steady boat traffic, so fly the dive flag Florida law requires and surface beside it.",
      divePlan:
        "Start on the north or south buoy depending on what little current there is, follow the eastern ledge, and drift west to the staghorn on the return.",
      fitTone: "welcoming",
      creatureSlugs: [
        "staghorn-coral",
        "tarpon",
        "french-grunt",
        "sergeant-major",
        "bluehead-wrasse",
      ],
    },
  },
  // Hall of Fame Reef
  {
    slug: "hall-of-fame-reef",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://www.floridagofishing.com/_pdf/reefs-broward-gps-mooring-buoys.pdf",
      "https://www.southfloridadiving.com/dive-sites/recreational/hall-of-fame-reef/",
      "https://seaxp.com/south-florida-reefs/",
    ],
    briefing: {
      name: "Hall of Fame Reef",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1924,
      forecastLongitude: -80.0846,
      description:
        "A shallow buoyed ridge between Oakland Ridges and the Copenhagen, named for the swimming hall of fame on the beach behind it. Ledges and undercuts along its east face hold most of the life.",
      marineLife: "Grunts · snapper · angelfish · spiny lobster · moray eels",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (15–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Usually very little current and long bottom times. It is run as a buoy dive or a gentle drift; either way, a dive flag is the law here and boats pass close inshore.",
      divePlan:
        "From any buoy, follow the ridge north or south along the eastern ledge and turn back on gas.",
      fitTone: "welcoming",
      creatureSlugs: [
        "bluestriped-grunt",
        "gray-snapper",
        "french-angelfish",
        "spiny-lobster",
        "green-moray",
      ],
    },
  },
  // Anglin's Ledge (Anglin Pier Reef). Written for the outer-reef ledge operators dive as
  // Anglin Pier Reef (50–60 ft); the FDEP point is a separate, shallower buoyed ledge.
  {
    slug: "anglin-pier-reef",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://www.southfloridadiving.com/dive-sites/recreational/anglin-pier-reef/",
      "https://www.scubadiversworld.com/sites.html",
    ],
    briefing: {
      name: "Anglin Pier Reef",
      locationName: "off Lauderdale-by-the-Sea, Florida",
      forecastLatitude: 26.1908,
      forecastLongitude: -80.0725,
      description:
        "A section of the outer reef offshore of Anglin's Pier, with one 3–4 m ledge facing the beach for most of its length. Often the second dive after the deep Pompano wrecks, and rich enough to earn it.",
      marineLife: "Spiny lobster · grouper · snapper · Caribbean reef sharks",
      marineLifeDescription:
        "The ledge is packed with reef fish; reef sharks turn up now and then along the deeper side.",
      difficultyLevel: "intermediate",
      depthRange: "15–18 m (50–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Run as a drift along the ledge in the northward Gulf Stream set, which varies day to day. Ascend on an SMB and stay with the group so the boat can follow you.",
      divePlan:
        "Start at the north or south hook depending on current and drift the main ledge. The spur and groove to the east and a false ledge to the west are side trips.",
      fitTone: "demanding",
      fitNote: "Easy depth, but a drift: be comfortable with a negative entry and an SMB.",
      creatureSlugs: [
        "caribbean-reef-shark",
        "spiny-lobster",
        "black-grouper",
        "mutton-snapper",
        "queen-angelfish",
        "hogfish",
      ],
    },
  },
  // Oakland Ridges (Oakland Ledges)
  {
    slug: "oakland-ridges",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://www.floridagofishing.com/_pdf/reefs-broward-gps-mooring-buoys.pdf",
      "https://www.southfloridadiving.com/dive-sites/recreational/oakland-ridges/",
      "https://seaxp.com/south-florida-reefs/",
      "https://www.scubadivinginmiami.com/dive-sites/page/3/",
    ],
    briefing: {
      name: "Oakland Ridges",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1542,
      forecastLongitude: -80.089,
      description:
        "A shallow ridge off Oakland Park Boulevard, marked by a line of fifteen county mooring buoys. Broken ledges, crevices and table-top rocks along its east face make cover for a lot of young fish.",
      marineLife: "Glassy sweepers · snook · yellowhead jawfish · blennies · juvenile reef fish",
      marineLifeDescription:
        "Sweepers and snook hang under the ledges; the sand off the ridge is where the jawfish live.",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (15–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Usually mild. A popular snorkel and dive spot close to the beach, so fly a dive flag, which Florida law requires, and keep it close.",
      divePlan:
        "Follow the line of buoys along the eastern ledge, then swing west into the smaller ledges and crevices before heading back.",
      fitTone: "welcoming",
      fitNote: "Shallow, calm, and full of small things to find.",
      creatureSlugs: [
        "glassy-sweeper",
        "common-snook",
        "yellowhead-jawfish",
        "redlip-blenny",
        "french-grunt",
      ],
    },
  },
  // The Caves
  {
    slug: "the-caves-fort-lauderdale",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://www.floridagofishing.com/_pdf/reefs-broward-gps-mooring-buoys.pdf",
      "https://seaxp.com/south-florida-reefs/",
      "https://www.scubadivinginmiami.com/dive-sites/page/4/",
    ],
    briefing: {
      name: "The Caves",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1267,
      forecastLongitude: -80.0917,
      description:
        "A broken line of tall ledges about two miles north of Port Everglades, buoyed by the county. The overhangs make small caves, big enough for a nurse shark and never for a diver.",
      marineLife: "Nurse sharks · spiny lobster · grunts · snapper",
      marineLifeDescription:
        "Look under every overhang: lobster and resting nurse sharks are the usual finds.",
      difficultyLevel: "beginner",
      depthRange: "6–9 m (20–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Shallow and usually easy. Port Everglades traffic passes to the south: fly the dive flag Florida law requires and surface next to it.",
      divePlan:
        "Work the ledge from buoy to buoy, looking into the undercuts from outside, and come back along the sand edge.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The undercuts",
          kind: "reefFormation",
          note: "Overhangs along the ledge that give the site its name. Look in with a light; they are not swim-throughs.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "spiny-lobster",
        "french-grunt",
        "schoolmaster-snapper",
        "porkfish",
      ],
    },
  },
  // Barracuda Reef
  {
    slug: "barracuda-reef-fort-lauderdale",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://www.floridagofishing.com/_pdf/reefs-broward-gps-mooring-buoys.pdf",
      "https://seaxp.com/south-florida-reefs/",
      "https://www.scubadiversworld.com/sites.html",
    ],
    briefing: {
      name: "Barracuda Reef",
      locationName: "off Dania Beach, Florida",
      forecastLatitude: 26.0764,
      forecastLongitude: -80.0958,
      description:
        "A shallow reef running south of Port Everglades off John U. Lloyd Beach, with more than twenty county mooring buoys along it. Operators compare it to a Florida Keys reef, a short run from a cruise port.",
      marineLife: "Sea turtles · stingrays · nurse sharks · barracuda · spiny lobster",
      marineLifeDescription:
        "Turtles and rays travel the reef, and nurse sharks come through to the cleaning stations.",
      difficultyLevel: "beginner",
      depthRange: "6–11 m (20–35 ft)",
      maxDepthMeters: 11,
      currentNote:
        "Shallow, but close to the Port Everglades channel, where ship and boat traffic is constant. Stay on the buoyed reef, fly the dive flag Florida law requires, and never surface without it.",
      divePlan:
        "Follow the buoy line along the reef and turn back on gas; on a north set, drift it and let the boat follow.",
      fitTone: "welcoming",
      creatureSlugs: [
        "green-sea-turtle",
        "southern-stingray",
        "nurse-shark",
        "great-barracuda",
        "spiny-lobster",
        "stoplight-parrotfish",
      ],
    },
  },
  // Hillsboro Ledge
  {
    slug: "hillsboro-ledge",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://www.scubadiversworld.com/sites.html",
      "https://www.southfloridadiving.com/dive-sites/recreational/hillsboro-ledge/",
      "https://www.parrotislandscuba.com/reef.php",
    ],
    briefing: {
      name: "Hillsboro Ledge",
      locationName: "off Deerfield Beach, Florida",
      forecastLatitude: 26.3007,
      forecastLongitude: -80.0683,
      description:
        "A sheer ledge on the middle reef north of Hillsboro Inlet, about two metres high and riddled with holes. Shallow enough for a long, easy drift and a favourite during lobster mini-season.",
      marineLife: "Yellowhead jawfish · tobaccofish · spiny lobster · snook · tropical reef fish",
      marineLifeDescription:
        "The rubble and sand behind the ledge hold jawfish and tobaccofish; snook sometimes hang around the rock islands at the north end.",
      difficultyLevel: "beginner",
      depthRange: "9–12 m (30–40 ft)",
      maxDepthMeters: 12,
      currentNote:
        "Usually a drift with the northward current. Surface with an SMB and the boat's flag nearby: this is a short run from Hillsboro Inlet and boat traffic is heavy, especially on lobster weekends.",
      divePlan:
        "On a north current, follow the main ledge north and, with gas and time to spare, cross the short sand gap to the rock islands. On a south current, start at the islands.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The rock islands",
          kind: "reefFormation",
          note: "Two outcrops just north of where the ledge ends, forming a small swim-through.",
        },
      ],
      creatureSlugs: [
        "yellowhead-jawfish",
        "tobaccofish",
        "spiny-lobster",
        "common-snook",
        "bluestriped-grunt",
      ],
    },
  },
  // Labontee Reef (Labonte)
  {
    slug: "labonte-reef",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://www.scubadiversworld.com/sites.html",
      "https://www.southfloridadiving.com/dive-sites/recreational/labontee-reef/",
      "https://www.parrotislandscuba.com/reef.php",
    ],
    briefing: {
      name: "Labonte Reef",
      locationName: "off Hillsboro Beach, Florida",
      forecastLatitude: 26.2743,
      forecastLongitude: -80.0707,
      description:
        "A middle-reef ridge about a mile north of Hillsboro Inlet, with ledges on both its east and west sides and holes all along the inside edge. Close in and easy to find, it is a common training reef.",
      marineLife: "Spiny lobster · nurse sharks · snapper · grouper · tropical reef fish",
      marineLifeDescription:
        "Nurse sharks rest under the western ledge, and lobster fill the holes.",
      difficultyLevel: "beginner",
      depthRange: "10–14 m (33–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Run as a drift. Gaps in the reef edge make it easy to lose the ledge, so stay with your guide, and surface on an SMB: it is close to the inlet's boat traffic.",
      divePlan:
        "Drift the western ledge, which is the better side; the sand to the west of it is used for training skills.",
      fitTone: "welcoming",
      creatureSlugs: [
        "nurse-shark",
        "spiny-lobster",
        "gray-snapper",
        "graysby",
        "foureye-butterflyfish",
      ],
    },
  },
  // Lighthouse Ledge
  {
    slug: "lighthouse-ledge",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://www.scubadiversworld.com/sites.html",
      "https://www.southfloridadiving.com/dive-sites/recreational/lighthouse-ledge/",
      "https://www.parrotislandscuba.com/reef.php",
    ],
    briefing: {
      name: "Lighthouse Ledge",
      locationName: "off Hillsboro Beach, Florida",
      forecastLatitude: 26.271,
      forecastLongitude: -80.0642,
      description:
        "A stretch of the outer reef just north of Hillsboro Inlet, named for the historic lighthouse on shore. Its west-facing main ledge is among the most colourful in Broward, with big soft corals on the northern hook.",
      marineLife: "Sea fans and sea plumes · angelfish · tropical reef fish · sea turtles",
      marineLifeDescription:
        "Thousands of small reef fish over a ledge thick with soft coral; a turtle is a regular bonus.",
      difficultyLevel: "intermediate",
      depthRange: "14–20 m (45–67 ft)",
      maxDepthMeters: 20,
      currentNote:
        "A drift dive in the northward current. Close to Hillsboro Inlet, so boats use it on rough days, and the inlet traffic is busy: ascend on an SMB and wait for the boat.",
      divePlan:
        "On a north current, drop about a third of the way up the reef; on a south current, start at the north hook. Either way, drift the main western ledge.",
      fitTone: "demanding",
      fitNote: "Comfortable in a drift at 15–20 m, with an SMB of your own.",
      landmarks: [
        {
          name: "The northern hook",
          kind: "reefFormation",
          note: "Where the ledge curls at its north end, covered in large soft corals.",
        },
      ],
      creatureSlugs: [
        "common-sea-fan",
        "sea-plume",
        "queen-angelfish",
        "green-sea-turtle",
        "giant-barrel-sponge",
        "hogfish",
      ],
    },
  },
  // Okinawa
  {
    slug: "okinawa-wreck-pompano",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Okinawa%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/okinawa/",
      "https://www.parrotislandscuba.com/wreks.php",
    ],
    briefing: {
      name: "Okinawa",
      locationName: "Shipwreck Park, Pompano Beach, Florida",
      forecastLatitude: 26.2335,
      forecastLongitude: -80.0702,
      description:
        "A 33 m US Army tug built in 1953 and sunk upright in Shipwreck Park in 2017. Before she went down, an artist turned her deck into an underwater dive bar, the Midnight Sun, complete with a mermaid holding a mirrored globe.",
      marineLife: "Barracuda · amberjack · snapper · bait schools",
      marineLifeDescription:
        "Still a young wreck: the growth is filling in, and the bait and the fish that hunt it arrived first.",
      difficultyLevel: "intermediate",
      depthRange: "11–21 m (35–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Usually dived on the anchor line, but the Gulf Stream current here can pick up without warning. Stay outside the hull unless trained for wreck penetration.",
      divePlan:
        "Down the line to the pilothouse at about 11 m, tour the deck art and the propeller at the stern, and come back up the line on gas.",
      fitTone: "welcoming",
      fitNote:
        "The shallowest wreck in Shipwreck Park, and an easy first wreck if the current is kind.",
      landmarks: [
        {
          name: "The Midnight Sun bar",
          kind: "underwaterMonument",
          note: "A sculpted dive bar with sea creatures and a mermaid holding a mirrored globe. Look into it and you see yourself.",
        },
        {
          name: "Propeller",
          kind: "wreckFeature",
          note: "The tug's 2.4 m propeller at the stern, near the deepest part of the dive.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "greater-amberjack",
        "gray-snapper",
        "round-scad",
        "spanish-hogfish",
      ],
    },
  },
  // Captain Dan
  {
    slug: "captain-dan-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Captain%20Dan%20Garnsey%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/captain-dan/",
      "https://seaxp.com/south-florida-wrecks/",
      "https://www.parrotislandscuba.com/wreks.php",
      "https://www.scubadiversworld.com/sites.html",
    ],
    briefing: {
      name: "Captain Dan",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.2309,
      forecastLongitude: -80.066,
      description:
        "A 53 m Coast Guard buoy tender, built in 1937 as the Hollyhock and sunk upright off Pompano in 1990 in memory of a charter fishing captain. Intact, tall and always surrounded by fish.",
      marineLife: "Great barracuda · amberjack · grouper · bait schools",
      marineLifeDescription:
        "Big barracuda and jacks over the superstructure; operators have twice seen whale sharks here.",
      difficultyLevel: "advanced",
      depthRange: "21–34 m (70–110 ft)",
      maxDepthMeters: 34,
      currentNote:
        "Moderate to strong Gulf Stream current is common, so descend and ascend on the line and plan an SMB ascent if you lose it. Visibility is usually good. Stay outside the hull unless trained for penetration.",
      divePlan:
        "Down the line to the wheelhouse at about 21–24 m, along the deck at about 27 m, and back up the line before your no-decompression limit; the sand at 34 m is not the dive.",
      fitTone: "demanding",
      fitNote: "Deep and often current-swept. Comfortable at 30 m and on a line in moving water.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "The top of the wreck and the usual place to start and end the tour.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "greater-amberjack",
        "black-grouper",
        "horse-eye-jack",
        "round-scad",
      ],
    },
  },
  // Guy Harvey
  {
    slug: "guy-harvey-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Guy%20Harvey%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/guy-harvey/",
      "https://www.parrotislandscuba.com/wreks.php",
    ],
    briefing: {
      name: "Guy Harvey",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.2108,
      forecastLongitude: -80.0657,
      description:
        "A 56 m Dutch-built freighter, once the Lady Kimberly, sunk upright in 1997 and painted with fish murals by the wildlife artist Guy Harvey. The paint is long gone under the growth; the depth is what defines this dive.",
      marineLife: "Amberjack · great barracuda · grouper · sponges and soft coral",
      difficultyLevel: "advanced",
      depthRange: "30–40 m (100–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "The deck sits around 30 m and the sand deeper still, at about 41–44 m (135–144 ft), close to technical depth. Gulf Stream current is common, so it is a line dive with a short bottom time and an SMB as backup. Stay outside the hull.",
      divePlan:
        "Down the line to the top of the wreck, a short tour of the deck within no-decompression limits, and back up the line. Do not drop to the sand.",
      fitTone: "demanding",
      fitNote:
        "For deep-trained divers with recent experience at 30 m and beyond; operators call it borderline technical.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["greater-amberjack", "great-barracuda", "black-grouper", "almaco-jack"],
    },
  },
  // Rodeo 25
  {
    slug: "rodeo-25-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Rodeo%2025%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/rodeo-25/",
      "https://www.scubadiversworld.com/sites.html",
    ],
    briefing: {
      name: "Rodeo 25",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.2313,
      forecastLongitude: -80.0635,
      description:
        "A 66 m Dutch freighter, last named the Windward Trader, sunk upright in 1990 for the Pompano Beach Fishing Rodeo's 25th year. Her twin masts reach up to about 21 m and draw bait balls and the jacks that hunt them.",
      marineLife: "Bait balls · amberjack · jacks · great barracuda",
      marineLifeDescription:
        "The show is around the masts: bait schools packed tight and predators cutting through them.",
      difficultyLevel: "advanced",
      depthRange: "21–38 m (68–126 ft)",
      maxDepthMeters: 39,
      currentNote:
        "Deep, with Gulf Stream current common, so it is dived on the anchor line. The forward mast has fallen to starboard onto the sand. Stay outside the hull unless trained for penetration.",
      divePlan:
        "Down the line past the masts to the wheelhouse at about 24 m, along the deck, and back to the line on gas; the sand near 38 m is not the dive.",
      fitTone: "demanding",
      fitNote:
        "Deep and current-prone. The masts reward a diver who can hover still in moving water.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The masts",
          kind: "wreckFeature",
          note: "Twin masts above the wheelhouse, the shallowest point of the wreck and a classic silhouette shot. The forward one now lies on the sand.",
        },
      ],
      creatureSlugs: [
        "round-scad",
        "greater-amberjack",
        "horse-eye-jack",
        "great-barracuda",
        "almaco-jack",
      ],
    },
  },
  // RSB-1
  {
    slug: "rsb-1-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0068%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/rsb-1/",
      "https://www.scubadivinginmiami.com/dive-sites/page/4/",
    ],
    briefing: {
      name: "RSB-1",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.2274,
      forecastLongitude: -80.0649,
      description:
        "A 49 m oilfield tender, later a Navy workboat, sunk upright off Pompano Beach in 1994 and officially renamed the Jim Torgerson. Her tall wheelhouse and mast stand well off the sand and hold schools of fish.",
      marineLife: "Barracuda · jacks · snapper · schooling baitfish · grouper",
      difficultyLevel: "advanced",
      depthRange: "24–37 m (80–120 ft)",
      maxDepthMeters: 37,
      currentNote:
        "Usually dived as a drift in the Gulf Stream's northbound current, with the boat following a surface float. Operators quote the bottom at about 33 m; the state reef record puts the sand at 37 m. Florida law requires a divers-down flag, and the Hillsboro Inlet boat lanes are close by.",
      fitTone: "demanding",
      fitNote:
        "Deep and often current-swept; the upper structure is where most of the dive happens.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Wheelhouse and mast",
          kind: "wreckFeature",
          note: "The tallest structure on the wreck, with the bow pointing north. Fish school around the mast.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "greater-amberjack",
        "horse-eye-jack",
        "gray-snapper",
        "black-grouper",
        "lionfish",
      ],
    },
  },
  // Union Express
  {
    slug: "union-express-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0061%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/union-express/",
    ],
    briefing: {
      name: "Union Express",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.2346,
      forecastLongitude: -80.0645,
      description:
        "A German-built coastal freighter seized for drug running and sunk off Pompano Beach in 1992, recorded by the state as Mariner 1. She lies on her port side in two pieces, one of a cluster of wrecks just south of Hillsboro Inlet.",
      marineLife: "Jacks · barracuda · snapper · schooling baitfish",
      marineLifeDescription:
        "Big schools move between this wreck and its neighbours, and larger predators follow them.",
      difficultyLevel: "advanced",
      depthRange: "24–33 m (80–108 ft)",
      maxDepthMeters: 33,
      currentNote:
        "The Gulf Stream usually runs north here, so this is a drift dive under a float and divers-down flag, as Florida law requires. Expect boat traffic from Hillsboro Inlet, and fishing line on the hull.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Mariner II Barge",
          kind: "wreckFeature",
          note: "Lies a short swim to the east-northeast, deeper, for divers whose plan and gas allow it.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "greater-amberjack",
        "gray-snapper",
        "lionfish",
        "goliath-grouper",
      ],
    },
  },
  // Mariner II (barge and tug)
  {
    slug: "mariner-ii-barge-and-tug",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0064%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/mariner-ii-barge/",
      "https://www.southfloridadiving.com/dive-sites/recreational/mariner-ii-tug/",
    ],
    briefing: {
      name: "Mariner II Barge and Tug",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.2226,
      forecastLongitude: -80.0532,
      description:
        "A steel barge and the tug Mary St. Phillip, sunk together in May 1993 about a mile south of Hillsboro Inlet. The two sit upright on sand and rubble, joined by a cable that runs from the barge's bow south past a small box to the tug.",
      marineLife: "Amberjack · jacks · grouper · barracuda · the odd billfish",
      difficultyLevel: "advanced",
      depthRange: "33–39 m (110–126 ft)",
      maxDepthMeters: 39,
      currentNote:
        "Deep, with the Gulf Stream's northbound drift; with the right current you can drift from one wreck to the other along the cable. Bottom time is short at this depth, so plan the swim before you go. Fly a divers-down flag as Florida law requires.",
      fitTone: "demanding",
      fitNote:
        "For a diver comfortable deep and in current, with gas planned for a swim between two wrecks.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The barge",
          kind: "wreckFeature",
          note: "About 34 m long and 12 m wide, upright with the bow to the south.",
        },
        {
          name: "Bow cable",
          kind: "navigationMark",
          note: "Runs south from the barge past a 3 m box to the tug, and makes the crossing easy to follow.",
        },
      ],
      creatureSlugs: [
        "greater-amberjack",
        "almaco-jack",
        "horse-eye-jack",
        "black-grouper",
        "great-barracuda",
      ],
    },
  },
  // Jay Dorman
  {
    slug: "jay-dorman-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0043%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/wreck-trek-pompano/",
      "https://www.parrotislandscuba.com/wreks.php",
    ],
    briefing: {
      name: "Jay Dorman",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.231,
      forecastLongitude: -80.0671,
      description:
        "The steel schooner Panda, sunk off Pompano Beach in the late 1980s as a memorial reef for Jay Dorman. Hurricane Andrew broke her in two, and she lies on her port side just south of the schooner Alpha.",
      marineLife: "Grouper · hogfish · snapper · grunts · sharks",
      difficultyLevel: "intermediate",
      depthRange: "17–24 m (55–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Run as a drift with a northbound current: start on the Dorman, then follow the line of wrecks north. Sharks, bull sharks among them, are common here and spearfishing draws them in. Keep your flag line clear of the wreck; Florida law requires the flag.",
      divePlan:
        "Down on the Dorman, north to the Alpha and the Quallman tugs, and if gas allows head west and finish on top of the reef at about 15 m.",
      landmarks: [
        {
          name: "The Alpha",
          kind: "wreckFeature",
          note: "A second, flattened schooner about 15 m to the north, in line with the Dorman.",
        },
      ],
      creatureSlugs: [
        "black-grouper",
        "hogfish",
        "gray-snapper",
        "porkfish",
        "nurse-shark",
        "lionfish",
      ],
    },
  },
  // Alpha
  {
    slug: "alpha-wreck-pompano",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0042%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/quallman-tugs/",
      "https://www.parrotislandscuba.com/wreks.php",
    ],
    briefing: {
      name: "Alpha",
      locationName: "off Pompano Beach, Florida",
      forecastLatitude: 26.231,
      forecastLongitude: -80.0671,
      description:
        "A 26 m riveted schooner sunk in 1988 on the outer edge of Pompano's third reef, a few metres north of the Jay Dorman. Storms have flattened her, so she is now low wreckage that fish and divers move across on the way north.",
      marineLife: "Grouper · hogfish · snapper · grunts · sharks",
      difficultyLevel: "intermediate",
      depthRange: "17–24 m (55–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Usually one stop on a drift along the Jay Dorman, Alpha and Quallman tugs with a northbound current. Bull sharks visit, especially where people spearfish. Florida law requires a divers-down flag; keep its line clear of the wreckage.",
      creatureSlugs: ["black-grouper", "hogfish", "gray-snapper", "french-grunt", "spotted-moray"],
    },
  },
  // Ancient Mariner
  {
    slug: "ancient-mariner-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0055%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/ancient-mariner/",
      "https://www.southfloridadiving.com/dive-sites/recreational/wreck-trek-deerfield/",
    ],
    briefing: {
      name: "Ancient Mariner",
      locationName: "off Deerfield Beach, Florida",
      forecastLatitude: 26.302,
      forecastLongitude: -80.0622,
      description:
        "The Coast Guard cutter Nemesis, launched in 1934, which hunted submarines in the war and later spent years as a floating restaurant before she was sunk off Deerfield Beach in 1991. She sits upright beside the reef, and is thick with growth.",
      marineLife: "Goliath grouper · snapper · grunts · angelfish · morays",
      marineLifeDescription:
        "A large goliath grouper is often found in the wheelhouse, and fish move freely between the wreck and the reef next to it.",
      difficultyLevel: "beginner",
      depthRange: "15–21 m (50–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Often dived as a drift with the Berry Patch Tug and Qualman Barge, so mind the northbound current and keep a divers-down flag with you, as Florida law requires. The aft deck has collapsed.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "Where the resident goliath grouper usually waits.",
        },
        {
          name: "Berry Patch Tug",
          kind: "navigationMark",
          note: "About 45 m off the bow on a heading of 150 degrees.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "gray-snapper",
        "porkfish",
        "gray-angelfish",
        "green-moray",
        "atlantic-spadefish",
      ],
    },
  },
  // Berry Patch Tug
  {
    slug: "berry-patch-tug",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0038%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/berry-patch-tug/",
      "https://www.parrotislandscuba.com/wreks.php",
    ],
    briefing: {
      name: "Berry Patch Tug",
      locationName: "off Deerfield Beach, Florida",
      forecastLatitude: 26.3014,
      forecastLongitude: -80.0617,
      description:
        "A 1940 tug, first named A.L. Spencer, that towed sand barges from the Bahamas before she was sunk off Deerfield Beach in 1987. Small and upright, settled deep in the sand, and covered in growth and tropical fish.",
      marineLife: "Tropical reef fish · lobster · grunts · snapper",
      difficultyLevel: "beginner",
      depthRange: "15–21 m (50–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "A short swim from the Ancient Mariner with the right current, and usually part of the Deerfield wreck drift. Florida law requires a divers-down flag; tie it off rather than let it tangle on the tug.",
      fitTone: "welcoming",
      fitNote: "A good wreck to practise navigation from the Ancient Mariner.",
      creatureSlugs: [
        "spiny-lobster",
        "french-grunt",
        "gray-snapper",
        "sergeant-major",
        "blue-angelfish",
      ],
    },
  },
  // Qualman Barge (Deerfield wreck trek)
  {
    slug: "qualman-barge-deerfield",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0099%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/wreck-trek-deerfield/",
    ],
    briefing: {
      name: "Qualman Barge",
      locationName: "off Deerfield Beach, Florida",
      forecastLatitude: 26.2996,
      forecastLongitude: -80.0618,
      description:
        "A 30 m steel barge sunk in 2000 at the south end of the Deerfield wreck trek. It is the usual start or finish of a drift that also takes in the Berry Patch Tug and the Ancient Mariner.",
      marineLife: "Snapper · grunts · grouper · tropical reef fish",
      difficultyLevel: "beginner",
      depthRange: "15–21 m (50–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "The current decides which end you start from. Rebar stakes in the sand mark the way between wrecks; keep your divers-down flag, which Florida law requires, clear of the wreckage.",
      divePlan:
        "From the barge, follow the stakes on about 240 degrees to the reef edge, then follow the edge until the Berry Patch Tug appears on your left, about 180 m away. The Ancient Mariner is another 45 m beyond.",
      fitTone: "welcoming",
      fitNote: "Shallow and forgiving, with real navigation practice built in.",
      landmarks: [
        {
          name: "Rebar stakes",
          kind: "navigationMark",
          note: "Set in the sand between the three wrecks to guide divers across.",
        },
      ],
      creatureSlugs: ["gray-snapper", "french-grunt", "graysby", "bluehead-wrasse", "lionfish"],
    },
  },
  // Rapa Nui Reef
  {
    slug: "rapa-nui-reef",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0088%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/rapa-nui-reef/",
    ],
    briefing: {
      name: "Rapa Nui Reef",
      locationName: "off Deerfield Beach, Florida",
      forecastLatitude: 26.3168,
      forecastLongitude: -80.062,
      description:
        "A 46 m barge loaded with concrete Easter Island heads, sunk east of the Deerfield Beach pier in 2015. It flipped on the way down and landed on its own statues, so what you dive is an upturned barge with sculpture fragments beneath it.",
      marineLife: "Snapper · grunts · tropical reef fish",
      difficultyLevel: "beginner",
      depthRange: "15–21 m (50–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "The barge stands only about 3 m off the sand, so it is a short, easy wreck to cover. Expect the usual northbound drift, and boat and fishing traffic near the pier. Florida law requires a divers-down flag.",
      fitTone: "welcoming",
      creatureSlugs: ["gray-snapper", "french-grunt", "sergeant-major", "bluehead-wrasse"],
    },
  },
  // Jay Scutti
  {
    slug: "jay-scutti-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0033%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/jay-scutti/",
      "https://seaxp.com/south-florida-wrecks/",
      "https://www.parrotislandscuba.com/wreks.php",
    ],
    briefing: {
      name: "Jay Scutti",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1587,
      forecastLongitude: -80.0793,
      description:
        "A Dutch-built Aruba harbour tug, seized on a smuggling run and sunk off Fort Lauderdale in 1986. She sits upright, bow north, so heavily grown over with sponges, hydroids and soft corals that her propeller blades now only fit fish.",
      marineLife: "Parrotfish · snapper · grunts · stingrays · horse conch",
      marineLifeDescription:
        "The growth feeds grazing parrotfish, and stingrays sometimes lie half buried in the sand by the stern.",
      difficultyLevel: "beginner",
      depthRange: "17–22 m (55–72 ft)",
      maxDepthMeters: 22,
      currentNote:
        "One of a line of wrecks joined by cable and stakes, often drifted with the Gulf Stream's northbound current. Florida law requires a divers-down flag; tie it off if you stay on the wreck so it does not snag.",
      fitTone: "welcoming",
      fitNote: "A classic first Fort Lauderdale wreck: shallow, upright and easy to navigate.",
      landmarks: [
        {
          name: "The Pride",
          kind: "wreckFeature",
          note: "A steel sailboat hull to the south, joined to the tug by a cable.",
        },
        {
          name: "Tracy",
          kind: "navigationMark",
          note: "The next wreck north, about 60 m away along a chain.",
        },
      ],
      creatureSlugs: [
        "stoplight-parrotfish",
        "gray-snapper",
        "porkfish",
        "southern-stingray",
        "florida-horse-conch",
        "branching-tube-sponge",
      ],
    },
  },
  // Tracy (Ken Vitale)
  {
    slug: "tracy-ken-vitale-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0095%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/tracey/",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Tracy (Ken Vitale)",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1593,
      forecastLongitude: -80.0794,
      description:
        "A 40 m freighter seized by Customs for drug trafficking and sunk in 1999, renamed in the state's records for Ken Vitale, a much-loved local instructor whose plaque is on board. She sits upright between the Jay Scutti and the Merci Jesus.",
      marineLife: "Snapper · grunts · angelfish · tropical reef fish",
      difficultyLevel: "beginner",
      depthRange: "14–22 m (45–72 ft)",
      maxDepthMeters: 22,
      currentNote:
        "Chained to the Jay Scutti about 60 m to the south, and usually part of a drift along all three wrecks. Florida law requires a divers-down flag, and boat traffic off Fort Lauderdale is heavy, so ascend under it.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Ken Vitale plaque",
          kind: "underwaterMonument",
          note: "A memorial to the instructor the wreck is named for.",
        },
      ],
      creatureSlugs: [
        "gray-snapper",
        "french-grunt",
        "french-angelfish",
        "sergeant-major",
        "yellowtail-snapper",
      ],
    },
  },
  // Merci Jesus
  {
    slug: "merci-jesus-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0094%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/merci-jesus/",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Merci Jesus",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1606,
      forecastLongitude: -80.0791,
      description:
        "A 27 m freighter seized by Customs in 1998 and sunk that August as the northern end of the Fort Lauderdale wreck trek. Upright with her bow to the south, well grown and busy with tropical fish.",
      marineLife: "Tropical reef fish · snapper · grunts · morays",
      difficultyLevel: "beginner",
      depthRange: "14–22 m (45–72 ft)",
      maxDepthMeters: 22,
      currentNote:
        "A good navigator can drift from the Jay Scutti past the Tracy to here in one dive, following the stakes. Florida law requires a divers-down flag, and boat traffic off Fort Lauderdale is heavy, so ascend under it.",
      fitTone: "welcoming",
      creatureSlugs: [
        "gray-snapper",
        "bluestriped-grunt",
        "spotted-moray",
        "queen-angelfish",
        "lionfish",
      ],
    },
  },
  // Robert Edmister
  {
    slug: "robert-edmister-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0051%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/robert-edmister/",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Robert Edmister",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1532,
      forecastLongitude: -80.0806,
      description:
        "The 29 m Coast Guard cutter Cape Gull, built in 1953 and sunk off Fort Lauderdale in 1989 under a friend's name. Hurricane Andrew flattened parts of her, but she is covered in growth and still pulls in fish.",
      marineLife: "Snapper · grunts · grouper · tropical reef fish",
      difficultyLevel: "beginner",
      depthRange: "14–23 m (45–76 ft)",
      maxDepthMeters: 23,
      currentNote:
        "A cable runs from her stern to the Wendy Rossheim about 30 m away, and the Jay Scutti lies about 300 m north. Mind the northbound drift and fly a divers-down flag, as Florida law requires.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Cable to the Wendy Rossheim",
          kind: "navigationMark",
          note: "Leads from the stern to the neighbouring yacht wreck.",
        },
      ],
      creatureSlugs: ["gray-snapper", "french-grunt", "graysby", "gray-angelfish", "lionfish"],
    },
  },
  // Peter B. McAllister
  {
    slug: "peter-b-mcallister-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0092%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/peter-b-mcallister/",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Peter B. McAllister",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1692,
      forecastLongitude: -80.0786,
      description:
        "A 26 m New York harbour tug from the McAllister Towing fleet, sunk off Fort Lauderdale in 1998. Built heavy, she has held her shape well and sits upright with a slight list to starboard.",
      marineLife: "Snapper · grunts · jacks · tropical reef fish",
      difficultyLevel: "beginner",
      depthRange: "15–23 m (50–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Small enough to see in one pass, with the steel boat Bruce Mueller a short swim to the southeast. Expect the Gulf Stream's northbound drift, and fly a divers-down flag as Florida law requires.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Bruce Mueller",
          kind: "wreckFeature",
          note: "A small steel workboat lying within swimming distance to the southeast.",
        },
      ],
      creatureSlugs: ["gray-snapper", "porkfish", "bar-jack", "sergeant-major", "spotted-moray"],
    },
  },
  // Mercedes I
  {
    slug: "mercedes-i-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0023%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/mercedes-i/",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Mercedes I",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1562,
      forecastLongitude: -80.0752,
      description:
        "A 60 m German freighter that a 1984 storm threw onto a Palm Beach socialite's seawall, made famous by the months it took to drag her off. Broward County bought her and sank her as a reef in March 1985 in front of thousands of spectators.",
      marineLife: "Snapper · grunts · jacks · barracuda · morays",
      marineLifeDescription:
        "Storms have broken her up, but the wreckage and the reef beside her still hold a lot of fish.",
      difficultyLevel: "intermediate",
      depthRange: "18–30 m (60–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Storms have twisted her into two pieces with a collapsed midship and loose, jagged structure, so stay outside and watch for entanglement. The Gulf Stream current can run, and Florida law requires a divers-down flag.",
      fitTone: "demanding",
      // Sand at 30 m, broken structure and Gulf Stream current: the gate the operators set, short of a deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "gray-snapper",
        "bluestriped-grunt",
        "horse-eye-jack",
        "great-barracuda",
        "green-moray",
        "goliath-grouper",
      ],
    },
  },
  // Jim Atria
  {
    slug: "jim-atria-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0039%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/jim-atria/",
      "https://seaxp.com/south-florida-wrecks/",
      "https://www.parrotislandscuba.com/wreks.php",
    ],
    briefing: {
      name: "Jim Atria",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1645,
      forecastLongitude: -80.0704,
      description:
        "A 73 m Dutch freighter, the Poinciana, that capsized in the Miami River and was raised and sunk off Fort Lauderdale in 1987. She went down on her side; Hurricane Andrew later shoved her into deeper water and stood her upright, and her masts and hatches are now heavy with soft coral and sponge.",
      marineLife: "Barracuda · amberjack · glassy sweepers · squirrelfish · black grouper",
      marineLifeDescription:
        "Sweepers and squirrelfish fill the cargo hold, black grouper and hogfish work the sand under the hull, and barracuda and amberjack hang over the deck.",
      difficultyLevel: "advanced",
      depthRange: "21–40 m (70–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Deep, and exposed to the Gulf Stream's northbound current; most dives stay on the masts and the deck around the wheelhouse at about 29 m. The sand lies at about 40–41 m, and the state record still lists her original 34 m resting depth from before Andrew moved her. Florida law requires a divers-down flag.",
      divePlan:
        "Down the masts to the main deck, along the starboard side to the wheelhouse, and back up the masts on the ascent. Bring a light for the colour.",
      fitTone: "demanding",
      fitNote: "For a confident deep diver; the colour on the upper structure is the reward.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The masts",
          kind: "wreckFeature",
          note: "Rise to about 21 m, the shallowest part of the wreck, covered in corals and sea fans.",
        },
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "At about 29 m, where the main deck meets it on the starboard side is one of the most grown-over corners of the wreck.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "greater-amberjack",
        "glassy-sweeper",
        "squirrelfish",
        "black-grouper",
        "hogfish",
      ],
    },
  },
  // Rebel
  {
    slug: "rebel-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0025%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/rebel/",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Rebel",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1709,
      forecastLongitude: -80.0722,
      description:
        "A small 1947 Dutch-built freighter, seized for smuggling and bought at federal auction by a Fort Lauderdale attorney, who gave her to the county reef program and named her after his dog. Sunk in 1985, she sits upright and bow north, crusted in coral.",
      marineLife: "Jacks · barracuda · baitfish · grouper",
      marineLifeDescription:
        "Jacks and barracuda patrol for bait balls over the open forward holds.",
      difficultyLevel: "advanced",
      depthRange: "21–34 m (70–111 ft)",
      maxDepthMeters: 34,
      currentNote:
        "Often a drift in the Gulf Stream's northbound current, dived from a live boat. Florida law requires a divers-down flag, and boat traffic off Fort Lauderdale is heavy.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Forward holds",
          kind: "wreckFeature",
          note: "Two open holds split by a crossbar, best seen from above.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "crevalle-jack",
        "great-barracuda",
        "black-grouper",
        "lionfish",
      ],
    },
  },
  // Hog Heaven (Jungle Gym)
  {
    slug: "hog-heaven-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0034%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://seaxp.com/south-florida-wrecks/",
      "https://www.duikersgids.nl/en/hog-heaven",
    ],
    briefing: {
      name: "Hog Heaven",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.135,
      forecastLongitude: -80.0798,
      description:
        "A 55 m derelict barge sunk off Fort Lauderdale in 1986 together with old lighthouse towers and concrete dredge pipe. The tower framework, known to divers as the Jungle Gym, draws crowds of fish.",
      marineLife: "Goliath grouper · hogfish · grunts · lobster · morays",
      marineLifeDescription:
        "Several goliath grouper often shelter inside the barge, and the tower swarms with reef fish.",
      difficultyLevel: "beginner",
      depthRange: "17–21 m (55–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "The barge lies upside down with holes in its hull; stay outside unless trained, and watch your head around the edges. Pleasure boats pass over the site, so surface under your divers-down flag, which Florida law requires.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The Jungle Gym",
          kind: "wreckFeature",
          note: "The steel lighthouse tower lying near the barge, alive with fish.",
        },
        {
          name: "Dredge pipe",
          kind: "pointOfInterest",
          note: "Lengths of concrete pipe sunk with the barge, with smaller barge pieces off its corners.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "hogfish",
        "french-grunt",
        "spiny-lobster",
        "green-moray",
        "porkfish",
      ],
    },
  },
  // Houseboat (Duzaway)
  {
    slug: "houseboat-duzaway-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0006%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://seaxp.com/south-florida-wrecks/",
      "https://www.scubadivinginmiami.com/dive-sites/page/2/",
    ],
    briefing: {
      name: "Houseboat",
      locationName: "off Fort Lauderdale, Florida",
      forecastLatitude: 26.1113,
      forecastLongitude: -80.0619,
      description:
        "A 21 m steel houseboat, the Duzaway, one of Broward's older artificial reefs, sunk in deeper water off Fort Lauderdale with other small vessels. Soft coral and baitfish make her colourful for her size.",
      marineLife: "Barracuda · baitfish · soft corals · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "23–29 m (75–95 ft)",
      maxDepthMeters: 29,
      currentNote:
        "Deeper than the inshore wrecks and open to the Gulf Stream's drift. The Port Everglades entrance channel lies a couple of kilometres south, so expect ship and boat traffic; Florida law requires a divers-down flag.",
      fitTone: "demanding",
      // The sand is at 29 m and the site sits in the Gulf Stream's drift: Advanced Open Water, short of a deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["great-barracuda", "horse-eye-jack", "gray-snapper", "sea-plume", "lionfish"],
    },
  },
  // Donald G. McAllister
  {
    slug: "donald-g-mcallister-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0093%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://seaxp.com/south-florida-wrecks/",
      "https://www.parrotislandscuba.com/wreks.php",
      "https://www.scubadivinginmiami.com/dive-sites/page/2/",
    ],
    briefing: {
      name: "Donald G. McAllister",
      locationName: "off Hollywood, Florida",
      forecastLatitude: 26.0091,
      forecastLongitude: -80.0928,
      description:
        "A 31 m New York harbour tug from the McAllister Towing fleet, sunk in June 1998 in Broward's southern reef sites. She sits upright and in good shape, rising about 8 m off the sand beside some reef rubble.",
      marineLife: "Lobster · snapper · grunts · tropical reef fish",
      difficultyLevel: "beginner",
      depthRange: "14–23 m (45–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Her top sits at about 14 m, so she suits newer divers. Several smaller wrecks lie within swimming distance; mind the northbound drift, and fly a divers-down flag as Florida law requires.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Captain Dede's",
          kind: "wreckFeature",
          note: "A concrete sailboat hull within swimming distance.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "gray-snapper",
        "porkfish",
        "sergeant-major",
        "spotted-moray",
      ],
    },
  },
  // Miss Dania Beach
  {
    slug: "miss-dania-beach-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0107%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Miss Dania Beach",
      locationName: "off Hollywood, Florida",
      forecastLatitude: 26.0101,
      forecastLongitude: -80.0917,
      description:
        "A former Canadian naval vessel of about 38 m, donated from a shipbuilder's estate and sunk in 2004 among Broward's southern wrecks. She stands about 8 m off the sand and has grown a good covering of sponge and coral.",
      marineLife: "Eels · grunts · sponges · corals",
      difficultyLevel: "beginner",
      depthRange: "18–22 m (60–72 ft)",
      maxDepthMeters: 22,
      currentNote:
        "Close to the Donald G. McAllister and other small wrecks, so a drift can take in more than one. Mind the northbound current, and fly a divers-down flag as Florida law requires.",
      fitTone: "welcoming",
      creatureSlugs: ["spotted-moray", "french-grunt", "giant-barrel-sponge", "gray-snapper"],
    },
  },
  // Ebenezer II (Eben-Ezer-2)
  {
    slug: "ebenezer-ii-wreck",
    version: 1,
    area: "florida-broward",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BO0103%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Ebenezer II",
      locationName: "off Hollywood, Florida",
      forecastLatitude: 26.0066,
      forecastLongitude: -80.0932,
      description:
        "A small freighter sunk in May 2002 among Broward's southern wrecks. She lies intact, bow to the south and listing hard to starboard, and is a favourite for small things.",
      marineLife: "Macro life · shrimp · crabs · reef fish",
      marineLifeDescription: "Bring a camera and look closely; the small stuff is the point here.",
      difficultyLevel: "beginner",
      depthRange: "18–21 m (60–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "A list of about 45 degrees can be disorienting along the deck, so watch your orientation. Mind the northbound drift, and fly a divers-down flag as Florida law requires.",
      fitTone: "welcoming",
      creatureSlugs: [
        "arrow-crab",
        "banded-coral-shrimp",
        "spotted-cleaner-shrimp",
        "christmas-tree-worm",
        "sergeant-major",
      ],
    },
  },
];
