// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Palm Beach County and the Treasure Coast: Fort Pierce to Boca Raton. */
export const FLORIDA_PALM_BEACH: DiveSiteTemplate[] = [
  {
    slug: "jupiter-goliath-ledges",
    version: 2,
    area: "florida-palm-beach",
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
    slug: "blue-heron-bridge",
    version: 2,
    area: "florida-palm-beach",
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
    area: "florida-palm-beach",
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
  // Denominator row: "Bonnie's Reef"
  {
    slug: "bonnies-reef-jupiter",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27BONNIE%27%27S%20REEF%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
    ],
    briefing: {
      name: "Bonnie's Reef",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.9308,
      forecastLongitude: -80.0205,
      description:
        "A high natural ledge off Jupiter with bays cut into its face, about 5 m from the top down to the sand. Goliath grouper live along the deep side all year, and the bays fill with schooling grunts.",
      marineLife: "Goliath grouper · loggerhead turtles · green morays · butter hamlets · tomtates",
      marineLifeDescription:
        "Turtles and the big morays keep to the foot of the ledge; the hamlets and angelfish are on top.",
      difficultyLevel: "intermediate",
      depthRange: "18–24 m (60–80 ft)",
      maxDepthMeters: 24,
      // Below 30 m, but a 23–24 m negative-entry Gulf Stream drift, past the Open Water ceiling; Jupiter boats run their ledges for Advanced divers.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Always a drift in the Gulf Stream, usually running north, and the boat follows your bubbles. Send up your own SMB before you leave the bottom: Jupiter Inlet boat traffic is heavy, and Florida law asks boats to keep 300 ft (90 m) from a dive flag.",
      divePlan:
        "Negative entry onto the ledge, then choose a depth: the sand at the foot for the grouper and turtles, or the top for the reef fish. Ascend together on the SMB.",
      fitNote:
        "The skill is the drift: a negative entry, staying with the group, and an SMB. Still past Open Water depth.",
      creatureSlugs: [
        "goliath-grouper",
        "loggerhead-turtle",
        "green-moray",
        "butter-hamlet",
        "tomtate",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: "Captain Kirle's (Captain Kurls)"
  {
    slug: "captain-kirles-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27CAPTAIN%20KIRLE%27%27S%20REEF%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://www.divoceandivecharters.com/dive-sites",
    ],
    briefing: {
      name: "Captain Kirle's",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.9265,
      forecastLongitude: -80.0202,
      description:
        "One of Jupiter's shallower ledges, broken into tiers and little cul-de-sacs that each hold their own crowd of fish. Often run as the second dive of the morning.",
      marineLife: "Hawksbill turtles · nurse sharks · goliath grouper · angelfish · porkfish",
      marineLifeDescription:
        "Turtles on top and napping underneath, nurse sharks tucked under the ledge, and pairs of butterflyfish the whole way along.",
      difficultyLevel: "intermediate",
      depthRange: "18–23 m (58–75 ft)",
      maxDepthMeters: 23,
      // Below 30 m, but a 23–24 m negative-entry Gulf Stream drift, past the Open Water ceiling; Jupiter boats run their ledges for Advanced divers.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "A Gulf Stream drift, usually north. Carry your own SMB and shoot it before the ascent; boats run in and out of Jupiter Inlet all day.",
      fitNote: "One of the shallowest Jupiter ledges, still past Open Water depth.",
      landmarks: [
        {
          name: "The tiers",
          kind: "reefFormation",
          note: "The ledge splits into several tiers. The western one tapers into sand, so drift back east to stay on reef; the eastern terrace has the cul-de-sacs and the turtles.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "nurse-shark",
        "goliath-grouper",
        "queen-angelfish",
        "foureye-butterflyfish",
        "porkfish",
      ],
    },
  },
  // Denominator row: "Julie's Reef"
  {
    slug: "julies-reef-jupiter",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27JULIE%27%27S%20REEF%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://www.divoceandivecharters.com/dive-sites",
    ],
    briefing: {
      name: "Julie's",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.9558,
      forecastLongitude: -80.0231,
      description:
        "A low, broken ledge off Jupiter that wanders east and west instead of running straight. The west side is for sightseeing; the scattered small ledges and holes on the east side are where the lobster hide.",
      marineLife: "Loggerhead turtles · spiny lobster · porkfish · angelfish · spotted morays",
      marineLifeDescription:
        "In nesting season, female loggerheads rest here by day before going up the beach at night.",
      difficultyLevel: "intermediate",
      depthRange: "19–23 m (61–75 ft)",
      maxDepthMeters: 23,
      // Below 30 m, but a 23–24 m negative-entry Gulf Stream drift, past the Open Water ceiling; Jupiter boats run their ledges for Advanced divers.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "A Gulf Stream drift like every Jupiter reef. The ledge zigzags, so follow the guide rather than a compass heading, and carry your own SMB.",
      conservationNote:
        "Spiny lobster may be taken only in season (6 August to 31 March) with a Florida saltwater fishing licence and lobster permit, by hand or tickle stick, and brought up whole.",
      fitNote:
        "Relaxed by Jupiter standards, good for long bottom times and for photographers who like small things.",
      creatureSlugs: [
        "loggerhead-turtle",
        "spiny-lobster",
        "porkfish",
        "french-angelfish",
        "spotted-moray",
        "nurse-shark",
      ],
    },
  },
  // Denominator row: "Loggerhead Reef"
  {
    slug: "loggerhead-reef-jupiter",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27LOGGERHEAD%20REEF%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://www.divoceandivecharters.com/dive-sites",
    ],
    briefing: {
      name: "Loggerhead",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.9467,
      forecastLongitude: -80.0223,
      description:
        "A low limestone ledge mixed with sandy patches and coral heads, about 600 m long, off one of the busiest sea turtle nesting beaches in the country. The name tells you what you will meet.",
      marineLife:
        "Loggerhead, green and hawksbill turtles · yellowhead jawfish · southern stingrays · green morays",
      marineLifeDescription:
        "Turtles are the point, most of all from March to October. Look in the sand patches for rays and jawfish hovering over their burrows.",
      difficultyLevel: "intermediate",
      depthRange: "18–23 m (60–76 ft)",
      maxDepthMeters: 23,
      // Below 30 m, but a 23–24 m negative-entry Gulf Stream drift, past the Open Water ceiling; Jupiter boats run their ledges for Advanced divers.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "A Gulf Stream drift, and the ledge is short, so go slowly or the dive is over early. Carry your own SMB; Jupiter Inlet traffic is heavy.",
      fitNote: "The shallowest of the regular Jupiter ledges, still past Open Water depth.",
      landmarks: [
        {
          name: "The amphitheatres",
          kind: "reefFormation",
          note: "Cul-de-sacs on the eastern side of the reef where the hawksbills and morays tend to be.",
        },
      ],
      creatureSlugs: [
        "loggerhead-turtle",
        "hawksbill-turtle",
        "green-sea-turtle",
        "yellowhead-jawfish",
        "southern-stingray",
        "green-moray",
      ],
    },
  },
  // Denominator row: "Juno Ledge (Monkey's Ledge)"
  {
    slug: "juno-ledge",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27JUNO%20LEDGE%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/deep-reef-diving-south-florida-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
    ],
    briefing: {
      name: "Juno Ledge",
      locationName: "off Juno Beach, Florida",
      forecastLatitude: 26.8724,
      forecastLongitude: -80.0135,
      description:
        "A dramatic natural ledge off Juno Beach, about 6 m tall, with overhangs that hold some of the largest goliath grouper in Florida. Some boats call it Monkey's Ledge.",
      marineLife: "Goliath grouper · lemon sharks · reef sharks · spotted eagle rays · turtles",
      marineLifeDescription:
        "Lemon sharks in winter, eagle rays and reef sharks most of the year, and now and then a hammerhead or tiger shark from the blue.",
      difficultyLevel: "advanced",
      depthRange: "21–28 m (68–92 ft)",
      maxDepthMeters: 28,
      currentNote:
        "A Gulf Stream drift that can run fast, at a depth where air goes quickly. Send up your own SMB before the ascent; the boat may be some way off following other groups.",
      divePlan:
        "Drop at the horseshoe and stay there a while: the big animals circle back past it. Then drift the ledge east and north at the group's pace and ascend together on an SMB.",
      fitTone: "demanding",
      fitNote:
        "Deep, fast water with big sharks around. Come comfortable with negative entries and a drift at 25 m.",
      // Advanced Open Water for the drift and the depth: the sand is at 28 m,
      // close to 30, reached by a negative entry into the Gulf Stream.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The horseshoe",
          kind: "reefFormation",
          note: "The curved bowl at the start of the drift where most of the shark and grouper encounters happen. Slow down here.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "lemon-shark",
        "caribbean-reef-shark",
        "spotted-eagle-ray",
        "nurse-shark",
        "loggerhead-turtle",
      ],
    },
  },
  // Denominator row: "MG-111 Barge"
  {
    slug: "mg-111-barge",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27MG-111%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Warrior%20Reef%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://www.divoceandivecharters.com/dive-sites",
    ],
    briefing: {
      name: "MG-111 Barge",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.9775,
      forecastLongitude: -80.025,
      description:
        "A 59 m Mississippi River hopper barge sunk off Jupiter in 1995 with a load of concrete, now a flat frame of steel beams and rubble. Just north lie concrete columns from the old Jupiter High School, added in 2005.",
      marineLife: "Goliath grouper · southern stingrays · spiny lobster · tomtates",
      marineLifeDescription:
        "From late August into October goliath grouper gather here to spawn, sometimes in very large numbers. Look small too: shrimp and nudibranchs live in the beams.",
      difficultyLevel: "intermediate",
      depthRange: "16–20 m (52–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "A Gulf Stream drift from the barge onto the columns. The wreck is low and open; stay outside the beams and give the grouper room. Carry your own SMB, close to Jupiter Inlet's boat traffic.",
      divePlan:
        "Drop on the barge, look through the beams, then let the current carry you north over the sand to the school columns before ascending on an SMB.",
      fitTone: "welcoming",
      fitNote:
        "Shallow for Jupiter and easy to read, with the aggregation as the reason to come back in late summer.",
      landmarks: [
        {
          name: "The barge",
          kind: "wreckFeature",
          note: "Little is left above the deck line: a long rectangle of steel beams and concrete rubble.",
        },
        {
          name: "The school columns",
          kind: "reefHistory",
          note: "Concrete pillars from the old Jupiter High School, laid just north of the barge as reef in 2005. The sand around them is good for stingrays.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "southern-stingray",
        "spiny-lobster",
        "tomtate",
        "lionfish",
      ],
    },
  },
  // Denominator row: "Cable Crossing"
  {
    slug: "cable-crossing-palm-beach",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://www.scubadiversworld.com/sites.html",
      "https://www.puravidadivers.com/shallow-dive-sites-south-florida/",
      "https://www.thepalmbeaches.com/explore/beaches-watersports/diving-snorkeling/diving-sites",
    ],
    briefing: {
      name: "Cable Crossing",
      locationName: "Palm Beach, Florida",
      forecastLatitude: 26.7096,
      forecastLongitude: -80.0284,
      description:
        "A short, shallow reef about 400 m off the beach just south of the Breakers hotel, named for the communications cable that crosses it. Low ledges full of small holes make it a training and snorkel stop.",
      marineLife: "Nurse sharks · sea turtles · grunts · sergeant majors",
      marineLifeDescription:
        "Nurse sharks rest under the ledges and turtles pass through; guitarfish and the odd manta ray have been seen.",
      difficultyLevel: "beginner",
      depthRange: "5–8 m (16–25 ft)",
      maxDepthMeters: 8,
      currentNote:
        "Usually only a moderate current, but swell and surge reach the bottom at this depth. Fly a dive flag: Florida law expects divers to stay within 300 ft (90 m) of it and boats to keep that far off.",
      fitTone: "welcoming",
      fitNote: "Shallow and gentle enough for a first ocean dive or a snorkel between tanks.",
      landmarks: [
        {
          name: "The cable",
          kind: "navigationMark",
          note: "The communications cable that gives the reef its name runs across it.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "green-sea-turtle",
        "sergeant-major",
        "bluestriped-grunt",
        "french-grunt",
      ],
    },
  },
  // Denominator row: "Flower Gardens (South Flower Gardens)"
  {
    slug: "flower-gardens-palm-beach",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27FLOWER%20GARDEN%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.scubadiversworld.com/sites.html",
      "https://www.puravidadivers.com/south-florida-reefs-60ft/",
      "https://www.stuartscuba.com/charters/flower-gardens-breakers-west-palm",
    ],
    briefing: {
      name: "Flower Gardens",
      locationName: "Palm Beach, Florida",
      forecastLatitude: 26.696,
      forecastLongitude: -80.0179,
      description:
        "The southern stretch of the Breakers reef line, so thick with soft corals and sea fans that the fish are hard to pick out from it. Also called South Flower Gardens.",
      marineLife: "Sea fans · spiny lobster · parrotfish · angelfish · sea turtles",
      marineLifeDescription:
        "Huge schools of reef fish move through the soft coral; lobster sit in the cracks.",
      difficultyLevel: "intermediate",
      depthRange: "13–16 m (42–54 ft)",
      maxDepthMeters: 16,
      currentNote:
        "A Gulf Stream drift, usually north at one to two knots. Carry an SMB and ascend on it; dive boats and fishing boats work this whole reef line.",
      fitTone: "welcoming",
      fitNote:
        "Open Water depth, and the current does the swimming. A drift briefing and an SMB are what you need.",
      creatureSlugs: [
        "common-sea-fan",
        "spiny-lobster",
        "stoplight-parrotfish",
        "queen-angelfish",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: "The Trench (Moray Alley)"
  {
    slug: "the-trench-moray-alley",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27THE%20TRENCH%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/south-florida-reefs-60ft/",
    ],
    briefing: {
      name: "The Trench (Moray Alley)",
      locationName: "Palm Beach, Florida",
      forecastLatitude: 26.7054,
      forecastLongitude: -80.0171,
      description:
        "A section of the Breakers reef line crossed by a straight cut about 4 m wide, made through the reef decades ago. Morays live along it, which is where the other name comes from.",
      marineLife:
        "Green, spotted, purplemouth and goldentail morays · yellowhead jawfish · sea turtles",
      marineLifeDescription:
        "Check the sand on the trench floor for jawfish hovering over their burrows.",
      difficultyLevel: "intermediate",
      depthRange: "14–18 m (47–58 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A Gulf Stream drift, usually north, so the current runs across the trench. Divers can drop into it and work east out of the flow. Ascend on an SMB.",
      fitTone: "welcoming",
      fitNote:
        "Open Water depth on a drift. Easy once you are comfortable with a negative entry and an SMB.",
      landmarks: [
        {
          name: "The cables",
          kind: "navigationMark",
          note: "Three communications cables lie east to west across the reef just before the trench. When you cross them, the trench is next.",
        },
        {
          name: "The trench",
          kind: "reefFormation",
          note: "The man-made cut running east to west through the reef, open above and wide enough to drop into.",
        },
      ],
      creatureSlugs: [
        "green-moray",
        "spotted-moray",
        "goldentail-moray",
        "yellowhead-jawfish",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: "Paul's Reef"
  {
    slug: "pauls-reef-palm-beach",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27PAUL%27%27S%20REEF%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/pauls-reef/",
      "https://www.puravidadivers.com/south-florida-reefs-60ft/",
      "https://www.scubadiversworld.com/sites.html",
    ],
    briefing: {
      name: "Paul's Reef",
      locationName: "off Palm Beach, Florida",
      forecastLatitude: 26.6441,
      forecastLongitude: -80.021,
      description:
        "An outer reef off Palm Beach and Lake Worth, named for Paul Lazeau Sr., one of the county's early divers. Its shape is unlike the straight ledges nearby: an amphitheatre at the south end, a collapsed ring of ledges on top, and a main ledge to the west.",
      marineLife: "Midnight parrotfish · barrel sponges · stingrays · moray eels · spiny lobster",
      marineLifeDescription:
        "Big sponges and sea fans everywhere, with the odd guitarfish on the sand. A favourite with photographers.",
      difficultyLevel: "intermediate",
      depthRange: "13–17 m (42–56 ft)",
      maxDepthMeters: 17,
      currentNote:
        "A drift, with the start set by the current. The Gulf Stream usually runs north here, but some days it turns south. Ascend on an SMB.",
      divePlan:
        "On a north current, start at the amphitheatre at the south end. On a south current, start at the north end where the sand meets the reef. Then choose the top of the reef or the main ledge.",
      fitTone: "welcoming",
      fitNote:
        "Open Water depth and plenty to look at. The only skill it asks for is drift diving.",
      landmarks: [
        {
          name: "The amphitheatre",
          kind: "reefFormation",
          note: "A bowl at the south end that is full of fish, and the start point on a north current.",
        },
        {
          name: "The collapsed feature",
          kind: "reefFormation",
          note: "On top of the reef: ledges in a complete circle around a sunken centre.",
        },
      ],
      creatureSlugs: [
        "midnight-parrotfish",
        "giant-barrel-sponge",
        "orange-elephant-ear-sponge",
        "southern-stingray",
        "green-moray",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: "Northwest Double Ledges (Shark Dive)"
  {
    slug: "northwest-double-ledges",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27NW%20DOUBLE%20LEDGES%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/deep-reef-diving-south-florida-reefs/",
    ],
    briefing: {
      name: "Northwest Double Ledges",
      locationName: "off Juno Beach, Florida",
      forecastLatitude: 26.8644,
      forecastLongitude: -80.0172,
      description:
        "Two parallel ledges with deep undercuts, just south of Juno Ledge. Local boats call it the Shark Dive, because reef and nurse sharks are close to a sure thing.",
      marineLife: "Reef sharks · nurse sharks · goliath grouper · turtles · amberjack",
      marineLifeDescription:
        "Sharks first, in the amphitheatre; now and then a bull, tiger or hammerhead. Gamefish and big tropicals along the ledges after.",
      difficultyLevel: "advanced",
      depthRange: "Sand at 27 m (87 ft)",
      maxDepthMeters: 27,
      currentNote:
        "A deep Gulf Stream drift, often strong. Watch your no-stop time, and carry your own SMB to send up before the ascent.",
      divePlan:
        "Watch the sharks in the amphitheatre at the start, then drift north along the upper ledge through the eroded rock. Ascend together on an SMB.",
      fitTone: "demanding",
      fitNote: "For divers comfortable with deep drift diving and with sharks close by.",
      // Advanced Open Water for the drift and the depth: sand at 27 m, close to
      // 30, reached by a negative entry into the Gulf Stream.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The amphitheatre",
          kind: "reefFormation",
          note: "A curve in the ledges where the sharks gather. Stay low, stay still, and let them come past.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "nurse-shark",
        "goliath-grouper",
        "loggerhead-turtle",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "South Double Ledges"
  {
    slug: "south-double-ledges",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27S%20DOUBLE%20LEDGES%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/deep-reef-diving-south-florida-reefs/",
    ],
    briefing: {
      name: "South Double Ledges",
      locationName: "off Palm Beach, Florida",
      forecastLatitude: 26.755,
      forecastLongitude: -80.0117,
      description:
        "A pair of natural ledges south of Palm Beach Inlet that curve northeast, so you can follow either the upper or the lower one. Well known among lobster hunters.",
      marineLife: "Spiny lobster · amberjack · angelfish · hogfish",
      marineLifeDescription: "Big tropicals along both ledges, with gamefish cruising past.",
      difficultyLevel: "advanced",
      depthRange: "21–27 m (68–87 ft)",
      maxDepthMeters: 27,
      currentNote:
        "A deep Gulf Stream drift, a few minutes from Palm Beach Inlet and its boat traffic. Carry your own SMB and send it up before the ascent.",
      fitTone: "demanding",
      fitNote: "A deep drift. Plan for short no-stop times on the lower ledge.",
      // Advanced Open Water for the drift and the depth: the lower ledge meets
      // the sand at 27 m, close to 30, in the Gulf Stream.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Upper and lower ledges",
          kind: "reefFormation",
          note: "Two parallel ledges. The lower one is deeper and usually busier; the upper one buys bottom time.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "greater-amberjack",
        "queen-angelfish",
        "gray-angelfish",
        "hogfish",
      ],
    },
  },
  // Denominator row: "Jolly Jacks"
  {
    slug: "jolly-jacks-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27JOLLY%20JACKS%20REEF%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/deep-reef-diving-south-florida-reefs/",
    ],
    briefing: {
      name: "Jolly Jacks",
      locationName: "off Singer Island, Florida",
      forecastLatitude: 26.837,
      forecastLongitude: -80.0182,
      description:
        "A natural reef that starts as a gentle slope and builds into a ledge about 4 m tall, worn into very deep undercuts. Local guides often call it their favourite dive.",
      marineLife: "Sea turtles · moray eels · stingrays · angelfish",
      marineLifeDescription: "The undercuts hold turtles and morays; tropicals crowd the top.",
      difficultyLevel: "advanced",
      depthRange: "21–25 m (70–82 ft)",
      maxDepthMeters: 25,
      currentNote:
        "A Gulf Stream drift, usually north, at a depth where no-stop time runs short. Carry your own SMB and send it up before the ascent.",
      fitTone: "demanding",
      fitNote:
        "A deep drift with a lot to look into. Watch your gauges as closely as the undercuts.",
      // Advanced Open Water for the drift and the depth: 25 m in the Gulf
      // Stream, where local boats run their deep reefs as Advanced charters.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "loggerhead-turtle",
        "green-moray",
        "southern-stingray",
        "french-angelfish",
        "gray-angelfish",
      ],
    },
  },
  // Denominator row: "Mid-Reef"
  {
    slug: "mid-reef-palm-beach",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27MID-REEF%27&outFields=FNAME,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/wreck-diving-sites-south-florida/",
      "https://www.scubaboard.com/community/threads/nov-23-24-something-different-out-of-palm-beach-inlet-excellent.470896/",
    ],
    briefing: {
      name: "Mid-Reef",
      locationName: "off Palm Beach Inlet, Florida",
      forecastLatitude: 26.7774,
      forecastLongitude: -80.011,
      description:
        "A natural reef with good relief just north of Palm Beach Inlet. The drift often ends at Spearman's Barge, an old deck barge sitting on the reef.",
      marineLife: "Hawksbill and loggerhead turtles · green morays · grouper",
      marineLifeDescription: "Turtles and green morays along the ledges and around the barge.",
      difficultyLevel: "advanced",
      depthRange: "21–27 m (70–90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "A Gulf Stream drift next to Palm Beach Inlet, one of the busiest boat channels on the coast. Carry your own SMB and ascend on it, well clear of the inlet. Stay outside the barge.",
      fitTone: "demanding",
      fitNote: "A deep drift close to heavy boat traffic. Come confident with an SMB.",
      // Advanced Open Water for the drift and the depth: the reef runs to about
      // 27 m in the Gulf Stream, beside the inlet.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "hawksbill-turtle",
        "loggerhead-turtle",
        "green-moray",
        "gag",
        "goliath-grouper",
      ],
    },
  },
  // Denominator row: "Mizpah Corridor (Corridor Wreck Trek: Mizpah, PC-1174, Amaryllis, Brazilian Docks, China Barge)"
  {
    slug: "mizpah-corridor",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Mizpah%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Amaryllis%27%20OR%20Name%3D%27PC-1174%27%20OR%20Name%3D%27South%20Corridors%20Reef%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/wreck-diving-sites-south-florida/",
      "https://www.thepalmbeaches.com/explore/beaches-watersports/diving-snorkeling/diving-sites",
    ],
    briefing: {
      name: "Mizpah Corridor",
      locationName: "off Palm Beach Inlet, Florida",
      forecastLatitude: 26.7863,
      forecastLongitude: -80.016,
      description:
        "A line of wrecks just north of Palm Beach Inlet, dived as one long drift: the 56 m yacht Mizpah and the patrol craft PC-1174, both sunk in 1968, then a rock corridor laid in 1994 leading to the hull of the 134 m freighter Amaryllis. With gas to spare you reach the Brazilian Docks and the China Barge.",
      marineLife: "Goliath grouper · sea turtles · southern stingrays · reef sharks",
      marineLifeDescription:
        "Goliath grouper crowd the Mizpah's decks, most of all in late summer; a reef shark often patrols just off the line.",
      difficultyLevel: "advanced",
      depthRange: "17–27 m (55–90 ft)",
      maxDepthMeters: 28,
      currentNote:
        "A Gulf Stream drift of about 500 m along the line, right beside the inlet's heavy boat traffic. Carry your own SMB and send it up before you leave the bottom. Stay outside the wrecks; the Amaryllis is only a hull and bottom deck.",
      divePlan:
        "Drop on the Mizpah, drift past the two halves of PC-1174 under her bow, follow the rock corridor north to the Amaryllis, and ascend on an SMB when gas says so.",
      fitTone: "demanding",
      fitNote:
        "One of the best dives in the county, and a deep drift on wrecks. Plan gas for a long swim you cannot turn around on.",
      // Advanced Open Water for the drift and the depth: sand at 25–27 m, a
      // negative entry into the Gulf Stream, next to the inlet. Outside the
      // wrecks only; penetration is a different card.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Mizpah",
          kind: "wreckFeature",
          note: "A 56 m yacht sunk in 1968, upright with three deck levels where the goliath grouper gather.",
        },
        {
          name: "PC-1174",
          kind: "wreckFeature",
          note: "A 50 m wartime patrol craft lying in two pieces just off the Mizpah's bow.",
        },
        {
          name: "The rock corridor",
          kind: "reefHistory",
          note: "Limestone boulders laid by the county in 1994 to link the Mizpah to the Amaryllis, so you can follow the reef from one wreck to the next.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "green-sea-turtle",
        "southern-stingray",
        "caribbean-reef-shark",
        "great-barracuda",
      ],
    },
  },
  // Ana Cecilia
  {
    slug: "ana-cecilia-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Ana%20Cecilia%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.underwaterjournal.com/?p=3378",
      "https://www.stuartscuba.com/charters/ana-cecilia-wreck-dive-at-stuart-scuba-an-advanced-dive-adventure",
    ],
    briefing: {
      name: "Ana Cecilia",
      locationName: "off Singer Island, Palm Beach, Florida",
      forecastLatitude: 26.7848,
      forecastLongitude: -80.0158,
      description:
        "A 52 m cargo ship seized by federal agents with cocaine aboard and sunk north of the Lake Worth Inlet in July 2016. She landed upright and whole, with big openings cut in her decks before the sinking, and memorial plaques on board.",
      marineLife: "Barracuda · blue runners · goliath grouper (late summer) · sponges",
      marineLifeDescription:
        "Barracuda and runners hang over the wheelhouse, and the goliaths gather on her from August into October.",
      difficultyLevel: "advanced",
      depthRange: "17–26 m (55–85 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Dived as a Gulf Stream drift, so expect a negative entry and an SMB up before you leave the bottom. Close to the Lake Worth Inlet's boat traffic: surface under your dive flag or SMB, and stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "Upright and easy to read, but deep and in current. Nitrox stretches the bottom time.",
      // Advanced Open Water for the drift, not the depth: a negative entry into
      // Gulf Stream current with the sand at 26 m, and operators sell it as an
      // Advanced dive.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wheelhouse",
          kind: "wreckFeature",
          note: "The top of the wreck at about 17 m, where the barracuda usually wait.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "blue-runner",
        "greater-amberjack",
        "lionfish",
      ],
    },
  },
  // Princess Anne
  {
    slug: "princess-anne-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Princess%20Anne%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.stuartscuba.com/charters/princess-anne-wreck-a-premier-dive-site-in-palm-beach",
      "https://www.puravidadivers.com/wreck-diving-sites-south-florida/",
    ],
    briefing: {
      name: "Princess Anne",
      locationName: "off Palm Beach Inlet, Florida",
      forecastLatitude: 26.7936,
      forecastLongitude: -80.0038,
      description:
        "A 104 m car ferry that carried passengers and cars across the Chesapeake Bay, sunk as a reef off Palm Beach in May 1993. Storms have since broken her into two pieces, and a natural reef just north of the hull is a dive of its own.",
      marineLife: "Jacks · barracuda · spadefish · parrotfish · the odd shark",
      marineLifeDescription:
        "Schools of jacks and spadefish hang over the hull, and bull sharks pass through in some seasons.",
      difficultyLevel: "advanced",
      depthRange: "22–34 m (72–110 ft)",
      maxDepthMeters: 34,
      currentNote:
        "The Gulf Stream usually runs hard here, so it is a drift with a negative entry and an SMB. The hull is broken and unstable; stay outside it. Inlet boat traffic is heavy, so surface under your dive flag or SMB.",
      fitTone: "demanding",
      fitNote:
        "Deep, big and fast. Divers not ready for the hull can drift the reef just north of it instead.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The hull top",
          kind: "wreckFeature",
          note: "The shallowest part of the wreck at about 22 m; the sand is past 30 m.",
        },
        {
          name: "The reef to the north",
          kind: "reefFormation",
          note: "A natural reef just north of the wreck, often dived on the same drift.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "atlantic-spadefish",
        "goliath-grouper",
        "stoplight-parrotfish",
      ],
    },
  },
  // Governor's Riverwalk Reef (Shasha Boekanier, St. Jacques, Gilbert Sea, Thozina)
  {
    slug: "governors-riverwalk-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Shasha%20Boekanier%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.stuartscuba.com/charters/governor-s-river-walk",
      "https://www.puravidadivers.com/wreck-diving-sites-south-florida/",
    ],
    briefing: {
      name: "Governor's Riverwalk Reef",
      locationName: "off Palm Beach, Florida",
      forecastLatitude: 26.7512,
      forecastLongitude: -80.0099,
      description:
        "Four coastal freighters seized in a Miami River smuggling crackdown and sunk together south of the Lake Worth Inlet in 2002: the Shasha Boekanier, St. Jacques, Gilbert Sea and Thozina. Rock corridors link them, so one drift can take in more than one hull.",
      marineLife: "Sea turtles · sharks · goliath grouper · tropical fish",
      marineLifeDescription:
        "Twenty years of growth have covered the hulls, and the fish and turtles move along the rock piles between them.",
      difficultyLevel: "advanced",
      depthRange: "17–27 m (55–90 ft)",
      maxDepthMeters: 28,
      currentNote:
        "A Gulf Stream drift: negative entry, stay with the group from wreck to wreck, and shoot an SMB before the ascent. Stay outside the hulls, and watch for boats near the inlet when you surface.",
      fitTone: "demanding",
      fitNote:
        "A training ground for advanced divers, with the sand close to 30 m and the current doing the steering.",
      // Advanced Open Water for the drift and the depth near 30 m: the sand is at
      // 27 m, and operators run it as an Advanced dive.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Shasha Boekanier memorial statue",
          kind: "underwaterMonument",
          note: "A statue placed by Delray Beach police and firefighters at the wreck's northern tip.",
        },
        {
          name: "Rock corridors",
          kind: "reefFormation",
          note: "Limestone piles laid between the four wrecks to lead divers and fish from one to the next.",
        },
      ],
      creatureSlugs: [
        "green-sea-turtle",
        "goliath-grouper",
        "great-barracuda",
        "nurse-shark",
        "gray-angelfish",
      ],
    },
  },
  // Eidsvag (Owens, The Triangle)
  {
    slug: "eidsvag-triangle",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Eidsvag%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27EIDSVAG%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/wreck-diving-sites-south-florida/",
      "https://reefsmartguides.com/?p=8120",
    ],
    briefing: {
      name: "Eidsvag Triangle",
      locationName: "off Palm Beach, Florida",
      forecastLatitude: 26.767,
      forecastLongitude: -80.0083,
      description:
        "A 46 m freighter, also called the Owens, sunk a few minutes south of the Lake Worth Inlet in 1985, with a barge and the remains of a Rolls-Royce car close by. Divers swim the triangle between the three.",
      marineLife: "Goliath grouper · sharks · barracuda · moray eels",
      marineLifeDescription:
        "Goliath grouper live on the freighter, and several kinds of shark pass through.",
      difficultyLevel: "intermediate",
      depthRange: "about 24 m (80 ft) on the sand",
      maxDepthMeters: 25,
      currentNote:
        "Best on a low-current day, when you can move between the freighter, the barge and the car; in a strong Gulf Stream run it becomes a one-way drift. Inlet boat traffic is close, so surface under your dive flag or SMB.",
      divePlan:
        "Start on the freighter, cross to the barge, find the car, and back to the freighter if the current lets you. Shoot an SMB before you leave the bottom.",
      landmarks: [
        {
          name: "The Rolls-Royce",
          kind: "wreckFeature",
          note: "What is left of a Rolls-Royce car, sunk on purpose near the freighter.",
        },
        {
          name: "Murphy's Barge",
          kind: "wreckFeature",
          note: "The barge that makes the third corner of the triangle.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "nurse-shark",
        "great-barracuda",
        "green-moray",
        "lionfish",
      ],
    },
  },
  // Danny McCauley Reef (The Danny)
  {
    slug: "danny-mccauley-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Danny%20Mccauley%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.puravidadivers.com/wreck-diving-sites-south-florida/",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27DANNY%20MCCAULEY%20MEMORIAL%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "The Danny",
      locationName: "off Singer Island, Palm Beach, Florida",
      forecastLatitude: 26.7933,
      forecastLongitude: -80.0183,
      description:
        "An ice-class steel tug, once the Pocahontas, sunk north of the Lake Worth Inlet in February 2013 in memory of a local teenager, Danny McCauley. She sits upright, and the sponges have been filling her in ever since.",
      marineLife: "Goliath grouper · tropical fish · new sponge growth",
      difficultyLevel: "intermediate",
      depthRange: "15–26 m (50–85 ft)",
      maxDepthMeters: 26,
      // Below 30 m, but a 26 m negative-entry Gulf Stream drift beside the inlet, sold as an Advanced dive like the Ana Cecilia nearby.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Gulf Stream current is common, so plan a negative entry and an SMB ascent. Close to the inlet's boat traffic; surface under your dive flag or SMB, and stay outside the hull.",
      fitTone: "demanding",
      fitNote: "Small enough to see whole in one dive, and a local favourite.",
      creatureSlugs: [
        "goliath-grouper",
        "gray-angelfish",
        "great-barracuda",
        "lionfish",
        "yellow-tube-sponge",
      ],
    },
  },
  // Spearman's Barge
  {
    slug: "spearmans-barge",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Spearman%27%27s%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.stuartscuba.com/charters/spearman-s-barge",
      "https://www.puravidadivers.com/wreck-diving-sites-south-florida/",
    ],
    briefing: {
      name: "Spearman's Barge",
      locationName: "off Palm Beach, Florida",
      forecastLatitude: 26.7932,
      forecastLongitude: -80.0058,
      description:
        "A steel deck barge sunk in 1978 on top of a natural reef north of the Lake Worth Inlet, and one of the oldest artificial reefs off Palm Beach. Decades of coral and sponge have made barge and reef one site, with a local murder mystery attached.",
      marineLife: "Turtles · goliath grouper · nurse sharks · green morays · lobster",
      marineLifeDescription:
        "Hawksbills and loggerheads visit often, and morays and lobster fill every crack in the plating.",
      difficultyLevel: "intermediate",
      depthRange: "to 21 m (70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Usually a drift in the Gulf Stream, so group up fast after a negative entry and carry an SMB. Boats run in and out of the inlet nearby; surface under your dive flag or SMB.",
      fitTone: "welcoming",
      fitNote: "Shallower than the other wrecks off the inlet, and a favourite with photographers.",
      creatureSlugs: [
        "hawksbill-turtle",
        "loggerhead-turtle",
        "goliath-grouper",
        "nurse-shark",
        "green-moray",
        "spiny-lobster",
      ],
    },
  },
  // Horseshoe Reef (Boynton)
  {
    slug: "horseshoe-reef-boynton",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27HORSESHOE%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/horseshoe-reef-2/",
    ],
    briefing: {
      name: "Horseshoe Reef",
      locationName: "off Boynton Beach, Florida",
      forecastLatitude: 26.6259,
      forecastLongitude: -80.0229,
      description:
        "One of the shallower outer reefs off Boynton, where the main ledge wanders in and out and then hooks back on itself at the north end, which gives the reef its name.",
      marineLife: "Spadefish · angelfish · grunts · sea turtles",
      marineLifeDescription: "Schools of spadefish are a regular sight along the ledge.",
      difficultyLevel: "beginner",
      depthRange: "12–17 m (40–55 ft)",
      maxDepthMeters: 17,
      currentNote:
        "A Gulf Stream drift dive: group up on the bottom, follow the ledge with the current, and send up an SMB before you ascend so the boat can find you. Stay near your dive flag or SMB when you surface; boats run this stretch of coast.",
      divePlan:
        "In a north current, start where the reef makes a V heading back east; in a south current, drop on the horseshoe hook at the north end first, then follow the main ledge south.",
      fitTone: "welcoming",
      fitNote: "A shallow, easy first drift on the outer reef.",
      landmarks: [
        {
          name: "The horseshoe",
          kind: "reefFormation",
          note: "The north end of the main ledge, where it hooks round and runs back south.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-angelfish",
        "french-angelfish",
        "bluestriped-grunt",
        "green-sea-turtle",
      ],
    },
  },
  // Lynn's Reef
  {
    slug: "lynns-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27LYNN%27%27S%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/lynns-reef/",
    ],
    briefing: {
      name: "Lynn's Reef",
      locationName: "off Boynton Beach, Florida",
      forecastLatitude: 26.5256,
      forecastLongitude: -80.0326,
      description:
        "Named for Lynn Simmons, who pioneered diving out of Boynton Beach. A stepped main ledge, flat-topped outcrops and a gap through the reef give it more corners to explore than most of the outer reefs here.",
      marineLife: "Lemon sharks · turtles · angelfish · lobster",
      marineLifeDescription:
        "A big lemon shark the locals call Mellow Yellow turns up now and then.",
      difficultyLevel: "beginner",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A Gulf Stream drift dive. Stay with the group along the ledge and put up an SMB before the ascent; boats run this coast, so surface near your dive flag or SMB.",
      divePlan:
        "In a north current, drop north of Castle Rocks and follow the main ledge, detouring west to the Table Tops. Near the north end, swim east through the Jump or carry on round the north hook.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Table Tops",
          kind: "reefFormation",
          note: "Flat-topped rock on the west side, halfway along the reef.",
        },
        {
          name: "The Jump",
          kind: "reefFormation",
          note: "A gap in the reef towards the north-east end, with ledges running east and west.",
        },
        {
          name: "Castle Rocks",
          kind: "reefFormation",
          note: "Outcrops along the main ledge, the usual drop point in a north current.",
        },
      ],
      creatureSlugs: [
        "lemon-shark",
        "green-sea-turtle",
        "queen-angelfish",
        "hogfish",
        "spiny-lobster",
      ],
    },
  },
  // Briny Breezes Reef
  {
    slug: "briny-breezes-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27BRINY%20BREEZE%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/briny-breezes/",
    ],
    briefing: {
      name: "Briny Breezes",
      locationName: "off Briny Breezes, Florida",
      forecastLatitude: 26.4995,
      forecastLongitude: -80.0368,
      description:
        "A stretch of the outer reef named for the seaside community directly inshore. It runs parallel to the beach, which makes it a natural drift, and turtles are often on it.",
      marineLife: "Sea turtles · angelfish · grunts · snapper",
      difficultyLevel: "beginner",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A Gulf Stream drift dive. Follow the western ledge with the current and send up an SMB before the ascent; surface near your dive flag or SMB, because boats run this coast.",
      divePlan:
        "Drop at the north or south end, depending on the current, and follow the western ledge. That is the most scenic line.",
      fitTone: "welcoming",
      creatureSlugs: [
        "green-sea-turtle",
        "loggerhead-turtle",
        "gray-angelfish",
        "french-grunt",
        "yellowtail-snapper",
      ],
    },
  },
  // Gazebo Reef
  {
    slug: "gazebo-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27GAZEBO%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/gazebo-reef/",
    ],
    briefing: {
      name: "Gazebo Reef",
      locationName: "off Boynton Beach, Florida",
      forecastLatitude: 26.5117,
      forecastLongitude: -80.0335,
      description:
        "The section of outer reef that picks up where Briny Breezes ends, with a double ledge and rock formations jutting west at the north end. Big schools of fish make it a photographer's reef.",
      marineLife: "Schooling grunts and snapper · angelfish · turtles",
      difficultyLevel: "beginner",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A Gulf Stream drift dive. Stay with the group along the two ledges and put up an SMB before the ascent; surface near your dive flag or SMB, because boats run this coast.",
      divePlan:
        "In a north current, drop a little north of Briny Breezes; in a south current, start at Castle Ledge. Follow the two main ledges.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Castle Ledge",
          kind: "reefFormation",
          note: "Rock formations jutting west from the reef at its north-west end.",
        },
        {
          name: "Pit Stop",
          kind: "reefFormation",
          note: "On the east side, where the reef turns slightly east.",
        },
      ],
      creatureSlugs: [
        "bluestriped-grunt",
        "yellowtail-snapper",
        "queen-angelfish",
        "green-sea-turtle",
        "porkfish",
      ],
    },
  },
  // Gulfstream Ledge (Gulfstream Reef)
  {
    slug: "gulfstream-ledge",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27GULFSTREAM%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/gulfstream-ledge/",
    ],
    briefing: {
      name: "Gulfstream Ledge",
      locationName: "off Gulf Stream, Florida",
      forecastLatitude: 26.4902,
      forecastLongitude: -80.0387,
      description:
        "A long, popular reef system off the town of Gulf Stream, with a main ledge, a clear spur-and-groove zone to the east, and a good chance of big animals.",
      marineLife: "Grouper · turtles · nurse sharks · angelfish",
      marineLifeDescription: "The south end's Grouper Hole lives up to its name.",
      difficultyLevel: "beginner",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A Gulf Stream drift, sometimes a brisk one. Follow the main ledge and put up an SMB before the ascent; surface near your dive flag or SMB, because boats run this coast. The deeper ridge farther east is a separate, deeper dive.",
      divePlan:
        "For the main ledge in a north current, drop on the Clubhouse; for the Grouper Hole, drop on the east side across from the Clubhouse and drift north.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "Clubhouse",
          kind: "reefFormation",
          note: "A favourite drop spot at the south end of the main ledge.",
        },
        {
          name: "Grouper Hole",
          kind: "reefFormation",
          note: "On the east side, across from the Clubhouse.",
        },
      ],
      creatureSlugs: [
        "black-grouper",
        "goliath-grouper",
        "green-sea-turtle",
        "nurse-shark",
        "french-angelfish",
      ],
    },
  },
  // Delray Ledges (Delray Ledge)
  {
    slug: "delray-ledges",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27DELRAY%20LEDGE%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/delray-ledges/",
    ],
    briefing: {
      name: "Delray Ledges",
      locationName: "off Delray Beach, Florida",
      forecastLatitude: 26.4695,
      forecastLongitude: -80.0433,
      description:
        "Tall, well-defined ledges halfway between two inlets, so fewer boats and hands reach it. Locals rate it among the best reefs on the coast, and it is thick with soft coral.",
      marineLife: "Sharks · snook · lobster · soft corals",
      marineLifeDescription:
        "Sharks are often seen, the north end is good for lobster, and snook sometimes school on the east side of the main ledge.",
      difficultyLevel: "beginner",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A Gulf Stream drift dive. The high ledges and the hook at each end make it easy to follow; put up an SMB before the ascent and surface near your dive flag or SMB.",
      divePlan: "Follow the main ledge north or south with the current, and take your time.",
      fitTone: "welcoming",
      creatureSlugs: [
        "nurse-shark",
        "common-snook",
        "spiny-lobster",
        "common-sea-fan",
        "queen-angelfish",
      ],
    },
  },
  // Stepping Stones Reef (Stepping Stone North)
  {
    slug: "boynton-stepping-stone-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Boynton%20Inlet%20Step%20Reef%20North%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27BOYNTON%20STEPPING%20STONE%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/stepping-stone-north/",
    ],
    briefing: {
      name: "Stepping Stone North",
      locationName: "off Boynton Beach, Florida",
      forecastLatitude: 26.5562,
      forecastLongitude: -80.0355,
      description:
        "A near-shore reef of big limestone boulders and two concrete modules, laid north of the Boynton Inlet in August 2013. It stands up to about 2.5 m off the sand and is already full of fish, crabs and lobster.",
      marineLife: "Tropical fish · lobster · crabs · juvenile reef fish",
      difficultyLevel: "beginner",
      depthRange: "8–11 m (25–35 ft)",
      maxDepthMeters: 11,
      currentNote:
        "Current is usually light here, so it is dived in circles rather than as a drift. It is close to the inlet and its boats: fly a dive flag and surface beside it.",
      divePlan:
        "Zigzag across the boulder field, or circle it, and come back to the modules at the north end.",
      fitTone: "welcoming",
      fitNote: "Shallow and gentle. A good place for new divers and snorkelers.",
      // Southern piece: FWC lists a separate 2011 Boynton Inlet Stepping Stones
      // pile about 1.2 km to the south in 9 m.
      landmarks: [
        {
          name: "The modules",
          kind: "reefFormation",
          note: "Two prefabricated concrete reef modules at the north end of the boulder field.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "sergeant-major",
        "porkfish",
        "bluehead-wrasse",
        "arrow-crab",
      ],
    },
  },
  // MV Castor
  {
    slug: "mv-castor-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Castor%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27CASTOR%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/mv-castor/",
    ],
    briefing: {
      name: "MV Castor",
      locationName: "off Boynton Beach, Florida",
      forecastLatitude: 26.4788,
      forecastLongitude: -80.0371,
      description:
        "A 79 m Dutch-built freighter seized by US Customs in 1999 with more than four tonnes of cocaine in her sugar sacks, and sunk off Boynton Beach in December 2001. Hurricanes have broken her up, but orange cup corals and sponges make her one of the most colourful wrecks on this coast.",
      marineLife: "Goliath grouper · jacks · barracuda · bait schools",
      marineLifeDescription:
        "Goliaths live here all year, and from late July their spawning gathering can reach a hundred fish, with clouds of scad and the jacks and barracuda that hunt them.",
      difficultyLevel: "advanced",
      depthRange: "24–34 m (80–110 ft)",
      maxDepthMeters: 34,
      currentNote:
        "Dived on a line or as a Gulf Stream drift; the sand lies past 30 m, so plan the gas and no-stop time carefully, and carry an SMB. The stern section has rolled onto its side; stay outside the structure. Surface near your dive flag or SMB.",
      fitTone: "demanding",
      fitNote: "Deep, so bottom time goes fast. Nitrox helps, and the grouper season is worth it.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The bow",
          kind: "wreckFeature",
          note: "The highest point of the wreck at about 24 m; the deck is around 29–30 m.",
        },
        {
          name: "The stern section",
          kind: "wreckFeature",
          note: "Most of the superstructure, now lying on its starboard side.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "horse-eye-jack",
        "great-barracuda",
        "round-scad",
        "lionfish",
      ],
    },
  },
  // Bud Bar (Budweiser Bar)
  {
    slug: "bud-bar-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Bud%20Bar%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27BUDBAR%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/bud-bar/",
    ],
    briefing: {
      name: "Bud Bar",
      locationName: "off Boynton Beach, Florida",
      forecastLatitude: 26.4792,
      forecastLongitude: -80.0385,
      description:
        "A German-built coastal freighter, once the Olive M, sunk off Boynton in the 1980s with a brewery's help, which is how she got her name. Still partly upright, she is covered in sponges, and her propeller is easy to find.",
      marineLife: "Sponges · grouper · snapper · schooling fish",
      difficultyLevel: "advanced",
      depthRange: "22–29 m (72–95 ft)",
      maxDepthMeters: 29,
      currentNote:
        "Dived on a line or as a Gulf Stream drift, often linked to the Captain Tony. The stern has broken away to the north-east; stay outside the hull, carry an SMB, and surface near your dive flag or SMB.",
      divePlan:
        "From the Bud Bar's stern, follow the rubble piles north-west to the Captain Tony's bow, a swim of 7–10 minutes.",
      fitTone: "demanding",
      // Advanced Open Water for depth near 30 m: the sand is at 29 m, and
      // operators run it as an Advanced dive.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The propeller",
          kind: "wreckFeature",
          note: "Still easy to recognise, like her engine room and galley.",
        },
        {
          name: "Rubble trail to the Captain Tony",
          kind: "reefFormation",
          note: "Concrete rubble piles running from the Bud Bar's stern to the Captain Tony's bow, about 180 m away.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Captain Tony (Becks Reef)
  {
    slug: "captain-tony-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Becks%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27BECKS%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/advanced-open-water/captain-tony/",
    ],
    briefing: {
      name: "Captain Tony",
      locationName: "off Boynton Beach, Florida",
      forecastLatitude: 26.4812,
      forecastLongitude: -80.0392,
      description:
        "A Dutch freighter, the Becks, sunk off Boynton in October 1996 and renamed for Tony Townsend, a local charter captain killed by a drunk boater weeks later. Storms have twisted her, with the mast leaning to port and the wheelhouse lying to starboard.",
      marineLife: "Schooling fish · goliath grouper · barracuda",
      marineLifeDescription: "Look up: big schools of fish circle over the wreck.",
      difficultyLevel: "advanced",
      depthRange: "15–25 m (49–82 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Dived on a line or as a Gulf Stream drift, often from the Bud Bar along the rubble trail. Stay outside the hull, carry an SMB, and surface near your dive flag or SMB.",
      fitTone: "demanding",
      // Advanced Open Water for the drift: operators sell it as an Advanced dive,
      // usually as part of a Gulf Stream wreck trek from the Bud Bar.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The leaning mast",
          kind: "wreckFeature",
          note: "The forward mast, which once rose to about 14 m and now leans out to port.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "gray-snapper",
        "lionfish",
      ],
    },
  },
  // Moray Bend
  {
    slug: "moray-bend",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27MORAY%20BEND%20REEF%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/moray-bend/",
    ],
    briefing: {
      name: "Moray Bend",
      locationName: "off Boca Raton, Florida",
      forecastLatitude: 26.3342,
      forecastLongitude: -80.0582,
      description:
        "A stretch of the outer reef off the Boca Raton Inlet, named for a resident moray. The west-facing main ledge stands up to 6 m tall in places and carries most of the coral and fish.",
      marineLife: "Moray eels · goliath grouper · lobster · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "14–21 m (45–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "A Gulf Stream drift along the ledge; carry an SMB. It is a short run from the inlet, which is why boats choose it on rough days, and why there is boat traffic overhead: surface near your dive flag or SMB.",
      divePlan:
        "Start at the north or south hook, depending on the current, and drift the main ledge. Lobster hunters sometimes head east to the spur and groove.",
      landmarks: [
        {
          name: "The main ledge",
          kind: "reefFormation",
          note: "The west-facing north-south ledge, up to 6 m high in places.",
        },
      ],
      creatureSlugs: [
        "green-moray",
        "spotted-moray",
        "goliath-grouper",
        "spiny-lobster",
        "gray-angelfish",
      ],
    },
  },
  // Boca Artificial Reef
  {
    slug: "boca-artificial-reef",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Boca%20Raton%20Reef%20%231%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/boca-artificial-reef/",
      "https://www.parrotislandscuba.com/reef.php",
    ],
    briefing: {
      name: "Boca Artificial",
      locationName: "off Boca Raton, Florida",
      forecastLatitude: 26.3225,
      forecastLongitude: -80.0558,
      description:
        "A section of the outer reef about 1 km off the coast south of the Boca Raton Inlet, with an undercut west ledge over 3 m tall. Its name comes from a small pile of concrete Erojacks set in a sand hollow beside it, some of them scattered by hurricanes since.",
      marineLife: "Angelfish · Bermuda chub · barracuda · lobster",
      difficultyLevel: "intermediate",
      depthRange: "12–21 m (40–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "A Gulf Stream drift along the ledge; carry an SMB. Close to the Boca Raton Inlet and its boat traffic, so surface near your dive flag or SMB.",
      divePlan:
        "Start at the north or south hook, depending on the current, and drift along the main ledge. Lobster hunters sometimes try the spur and groove to the east.",
      landmarks: [
        {
          name: "The Erojacks",
          kind: "reefHistory",
          note: "A pile of interlocking concrete blocks in a sand hollow, first stacked about 2 m high and partly scattered by storms.",
        },
      ],
      creatureSlugs: [
        "queen-angelfish",
        "bermuda-chub",
        "great-barracuda",
        "spiny-lobster",
        "common-sea-fan",
      ],
    },
  },
  // Sea Emperor (Aqua Zoo)
  {
    slug: "sea-emperor-aqua-zoo",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Sea%20Emperor%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27SEA%20EMPEROR%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/sea-emperor/",
      "https://www.southfloridadiving.com/dive-sites/recreational/aqua-zoo/",
    ],
    briefing: {
      name: "Sea Emperor (Aqua Zoo)",
      locationName: "off Boca Raton, Florida",
      forecastLatitude: 26.3223,
      forecastLongitude: -80.0591,
      description:
        "A 52 m hopper barge filled with concrete culverts and sunk off Boca Raton as part of a fine for reef damage. She flipped on the way down, landing upside down among her scattered culverts, and the piles became the Aqua Zoo.",
      marineLife: "Southern stingrays · goliath grouper · nurse sharks · moray eels",
      marineLifeDescription:
        "Big stingrays on the sand and goliaths in the culverts gave the site its nickname.",
      difficultyLevel: "intermediate",
      depthRange: "15–21 m (50–70 ft)",
      maxDepthMeters: 22,
      currentNote:
        "Usually an anchor dive, or a drift linking it to the United Caribbean. About 1 km from the Boca Raton Inlet, so expect boat traffic: surface near your dive flag or SMB. Stay outside the overturned hull.",
      divePlan:
        "Explore the barge and the culvert piles to its east, then follow the line of limestone boulders south-east to the United Caribbean if the current allows.",
      fitTone: "welcoming",
      fitNote: "Big animals at a friendly depth, and a photographer's favourite.",
      landmarks: [
        {
          name: "The culvert piles",
          kind: "wreckFeature",
          note: "About 1,600 tons of concrete pipe in and east of the barge, where the goliaths and rays settle.",
        },
        {
          name: "The yellow brick road",
          kind: "reefFormation",
          note: "A line of limestone boulders leading to the United Caribbean.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "goliath-grouper",
        "nurse-shark",
        "green-moray",
        "spotted-moray",
      ],
    },
  },
  // United Caribbean
  {
    slug: "united-caribbean-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27United%20Caribbean%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27UNITED%20CARIBBEAN%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/united-caribbean/",
    ],
    briefing: {
      name: "United Caribbean",
      locationName: "off Boca Raton, Florida",
      forecastLatitude: 26.3211,
      forecastLongitude: -80.059,
      description:
        "A 45 m steel freighter that, as the Golden Venture, ran aground off New York in 1993 carrying 286 smuggled migrants, ten of whom drowned. Renamed and later retired, she was sunk off Boca Raton in August 2000 and filled with life fast, with two other wrecks and a reef close by.",
      marineLife: "Goliath grouper · stingrays · nurse sharks · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "15–21 m (50–70 ft)",
      maxDepthMeters: 22,
      currentNote:
        "Usually an anchor dive, or a drift linking it to the Sea Emperor. Close to the Boca Raton Inlet and its boat traffic, so surface near your dive flag or SMB. Hurricane Wilma shifted and damaged her; stay outside the hull.",
      divePlan:
        "In a north current, start at the stern and follow the boulder line north-east to the Sea Emperor, about 75 m away.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The boulder line",
          kind: "reefFormation",
          note: "Limestone boulders laid off the stern as a trail to the Sea Emperor.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "southern-stingray",
        "nurse-shark",
        "great-barracuda",
        "gray-snapper",
      ],
    },
  },
  // Noula Express (Noulla Express)
  {
    slug: "noula-express-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Noula%20Express%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Environment_Open_Data/MapServer/0/query?where=FNAME%3D%27NOULA%20EXPRESS%27&outFields=FNAME,REEF_TYPE,DEC_DEG_LAT,DEC_DEG_LONG&returnGeometry=false&f=json",
      "https://www.southfloridadiving.com/dive-sites/recreational/noulla-express/",
    ],
    briefing: {
      name: "Noula Express",
      locationName: "off Boca Raton, Florida",
      forecastLatitude: 26.3213,
      forecastLongitude: -80.0575,
      description:
        "A 35 m Danish freighter built in 1939, seized in a drug case and sunk by the Palm Beach and Broward reef programmes. Hurricane Andrew broke off her bow and flattened her cargo hold, and a small smugglers' submarine now lies in the wreckage.",
      marineLife: "Filefish · barracuda · tropical fish",
      difficultyLevel: "intermediate",
      depthRange: "17–24 m (55–78 ft)",
      maxDepthMeters: 24,
      currentNote:
        "An anchor dive or a drift, sometimes linked to the Sea Emperor and United Caribbean about 90 m to the west. Close to the Boca Raton Inlet's boat traffic, so surface near your dive flag or SMB, and stay outside the broken hull.",
      divePlan:
        "Start on the wreck, then explore the small reef ledge and patch reefs around it before the ascent.",
      landmarks: [
        {
          name: "The bow",
          kind: "wreckFeature",
          note: "Broken off by Hurricane Andrew and tilted up, east of the hull.",
        },
        {
          name: "The submarine",
          kind: "wreckFeature",
          note: "A small one-man submarine once used by smugglers, under the flattened cargo area.",
        },
      ],
      creatureSlugs: [
        "whitespotted-filefish",
        "scrawled-filefish",
        "great-barracuda",
        "gray-angelfish",
        "lionfish",
      ],
    },
  },
  // Lofthus
  {
    slug: "lofthus-shipwreck-preserve",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://museumsinthesea.fpan.us/lofthus/",
      "https://www.nps.gov/articles/lofthus.htm",
    ],
    briefing: {
      name: "Lofthus",
      locationName: "Manalapan, Florida",
      forecastLatitude: 26.5629,
      forecastLongitude: -80.0385,
      description:
        "An iron-hulled barque built in England in 1868 that stranded off Manalapan in 1898 with a cargo of lumber, and was later blasted apart so the wood could be salvaged. Her scattered iron frames, beams and mast now make one of Florida's Underwater Archaeological Preserves.",
      marineLife: "Spiny lobster · porkfish · sergeant majors · spadefish · porcupinefish",
      marineLifeDescription:
        "Lobster hide under the deck plates, and anemones and sponges live inside the hollow masts.",
      difficultyLevel: "beginner",
      depthRange: "5–6 m (15–20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "About 160 m off the beach and 1.2 km north of the Boynton Inlet, so expect inlet boat traffic: tow a dive flag on a float and stay within 300 ft (90 m) of it, as Florida law requires. Shifting sand buries and uncovers the wreck from season to season, and visibility drops after storms.",
      divePlan:
        "Work the site from the bow's deck beams through the midships worm gear to the stern's mast section. Boats anchor in the sand, never on the wreck.",
      fitTone: "welcoming",
      fitNote: "Shallow enough to snorkel. A state preserve: look, photograph, and take nothing.",
      landmarks: [
        {
          name: "The worm gear",
          kind: "wreckFeature",
          note: "Midships, among deck beams, fasteners and hanging knees.",
        },
        {
          name: "The mast section",
          kind: "wreckFeature",
          note: "A length of iron mast at the stern, sticking out of the sand.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "porkfish",
        "sergeant-major",
        "atlantic-spadefish",
        "porcupinefish",
        "southern-stingray",
      ],
    },
  },
  // Georges Valentine
  {
    slug: "georges-valentine-shipwreck-preserve",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://museumsinthesea.fpan.us/georges-valentine/",
      "https://discovermartin.com/directory/dive-site-wreck-george-valentine/",
    ],
    briefing: {
      name: "Georges Valentine",
      locationName: "Hutchinson Island, Stuart, Florida",
      forecastLatitude: 27.1988,
      forecastLongitude: -80.1631,
      description:
        "An iron barkentine, built in Liverpool in 1869, that a gale drove ashore beside Gilbert's Bar House of Refuge in October 1904 while carrying mahogany. Seven of her crew survived, and her broken hull is now Martin County's Underwater Archaeological Preserve.",
      marineLife: "Snook · moray eels · lobster · stingrays · sea turtles",
      marineLifeDescription: "What lives on the wreck changes with the season.",
      difficultyLevel: "beginner",
      depthRange: "to 7 m (22 ft)",
      maxDepthMeters: 7,
      currentNote:
        "A shore dive about 90 m out from the rocks south of the House of Refuge. Surf and surge decide the day, and the rock entry is slippery. Tow a dive flag on a float and stay close to it, as Florida law requires; boats use this water too.",
      divePlan:
        "Park at the House of Refuge, enter from the rocky outcrop about 90 m south of it, and swim straight out to the wreck.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and snorkelable on a calm day. A state preserve: take nothing, and boats anchor in the sand.",
      landmarks: [
        {
          name: "Gilbert's Bar House of Refuge",
          kind: "navigationMark",
          note: "The old lifesaving station on shore, now a museum, that the wreck lies just south of.",
        },
      ],
      creatureSlugs: [
        "common-snook",
        "green-moray",
        "spiny-lobster",
        "southern-stingray",
        "atlantic-spadefish",
      ],
    },
  },
  // Urca de Lima
  {
    slug: "urca-de-lima-shipwreck-preserve",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://museumsinthesea.fpan.us/urca-de-lima/",
      "https://www.nps.gov/articles/urcadelima.htm",
    ],
    briefing: {
      name: "Urca de Lima",
      locationName: "Fort Pierce, Florida",
      forecastLatitude: 27.5053,
      forecastLongitude: -80.2992,
      description:
        "A Dutch-built storeship of the 1715 Spanish treasure fleet, driven aground off Fort Pierce by a hurricane days out of Havana. Her ballast mound still covers the hull timbers, and concrete replica cannons and an anchor mark it as one of Florida's Underwater Archaeological Preserves.",
      marineLife: "Wrasse · sailor's choice · porkfish · lobster · damselfish",
      difficultyLevel: "beginner",
      depthRange: "3–5 m (10–15 ft)",
      maxDepthMeters: 5,
      currentNote:
        "About 180 m off the beach on the first reef, reached by swimming from shore or by boat on the mooring buoy, never by anchoring. Surf and surge set the visibility. Tow a dive flag on a float, as Florida law requires, and watch for rock-boring urchins in the rock.",
      divePlan:
        "From Pepper Park, walk about 900 m north along the beach and swim out; boats tie to the preserve's mooring buoy.",
      fitTone: "welcoming",
      fitNote: "Shallow enough to snorkel. A state preserve: take nothing.",
      landmarks: [
        {
          name: "The ballast mound",
          kind: "wreckFeature",
          note: "A mound of ballast stones about 30 m by 15 m over the ship's lower hull.",
        },
        {
          name: "Replica cannons",
          kind: "reefHistory",
          note: "Five concrete cannons and an anchor placed around the site to show how it once looked.",
        },
      ],
      creatureSlugs: [
        "sailors-choice",
        "porkfish",
        "spiny-lobster",
        "peacock-flounder",
        "rock-boring-urchin",
      ],
    },
  },
  // USS Rankin
  {
    slug: "uss-rankin-wreck",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27USS%20Rankin%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.stuartscuba.com/calendar/reserve/6740c61f-4a80-40dc-ae7e-4ab3ac1e",
      "https://en.wikipedia.org/wiki/USS_Rankin",
    ],
    briefing: {
      name: "USS Rankin",
      locationName: "off Stuart, Florida",
      forecastLatitude: 27.1889,
      forecastLongitude: -80.0238,
      description:
        "A 140 m Navy attack cargo ship launched in 1944 that served at Okinawa and in the Cuban Missile Crisis, then was sunk off Stuart as a reef in July 1988. She lies on her starboard side, and her hull still stands about 22 m off the sand.",
      marineLife: "Barracuda · amberjack · grouper · bait schools",
      marineLifeDescription:
        "Barracuda hang above the hull and amberjack work the water column; sharks and turtles pass now and then.",
      difficultyLevel: "advanced",
      depthRange: "18–40 m (60–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Well offshore and open to the Gulf Stream, so current, visibility and seas change by the day. The upper side starts at about 18 m and the main deck is near 29 m; the sand at 40 m or a little deeper is past most recreational plans. Carry an SMB and stay outside the hull.",
      divePlan:
        "Descend to the upper side of the hull, follow it at a planned depth, and ascend on the line or under an SMB before the no-stop limit.",
      fitTone: "demanding",
      fitNote:
        "A deep, big wreck for experienced divers. Nitrox and a careful gas plan are the norm.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "greater-amberjack", "goliath-grouper", "lionfish"],
    },
  },
  // Denominator row: "Spadefish (Spadefish Point)"
  {
    slug: "spadefish-point-jupiter",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://www.divoceandivecharters.com/dive-sites",
      "https://divers-hub.com/SiteDetails/spadefish-point",
    ],
    briefing: {
      name: "Spadefish Point",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.8938,
      forecastLongitude: -80.0153,
      description:
        "A high ledge off Jupiter, the northern run of the Area 51 reef, with bowls cut into its top and a stone arch about halfway along. It takes its name from the schools of Atlantic spadefish that gather where the ledge bends west.",
      marineLife: "Atlantic spadefish · reef sharks · goliath grouper · sea turtles · green morays",
      marineLifeDescription:
        "Spadefish at the bend, morays in the cracks, and turtles and nurse sharks resting at the foot of the ledge.",
      difficultyLevel: "intermediate",
      depthRange: "18–24 m (60–80 ft)",
      maxDepthMeters: 26,
      currentNote:
        "Always a Gulf Stream drift, usually running north, and the boat follows your bubbles. Shoot your own SMB before you leave the bottom: boats run in and out of Jupiter Inlet all day, and Florida law asks them to keep 300 ft (90 m) from a dive flag.",
      divePlan:
        "Negative entry onto the ledge, then pick a depth: the sand at the foot for turtles and grouper, or the top edge and its bowls to stay shallower. Ascend together on the SMB.",
      fitTone: "welcoming",
      fitNote:
        "An easy ledge to follow that can be dived no deeper than about 23 m. The skill is the drift.",
      landmarks: [
        {
          name: "The arch",
          kind: "reefFormation",
          note: "A stone arch in one of the bowls about halfway along, standing off a smaller inner ledge. Porkfish usually crowd it.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "caribbean-reef-shark",
        "goliath-grouper",
        "loggerhead-turtle",
        "green-moray",
        "porkfish",
      ],
    },
  },
  // Denominator row: "Area 51"
  {
    slug: "area-51-jupiter",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.divoceandivecharters.com/dive-sites",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://divers-hub.com/SiteDetails/area-51",
    ],
    briefing: {
      name: "Area 51",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.8806,
      forecastLongitude: -80.0149,
      description:
        "One of the deeper Jupiter ledges, about 3–5 m tall and broken into big fallen blocks that make a maze along its foot. Reef sharks often come in from the east to look at divers in the first minutes of the dive.",
      marineLife:
        "Reef sharks · loggerhead and hawksbill turtles · goliath grouper · spadefish · barracuda",
      marineLifeDescription:
        "Sharks early, turtles and big green morays along the ledge, and jacks and barracuda working the current above it.",
      difficultyLevel: "advanced",
      depthRange: "21–27 m (70–90 ft)",
      maxDepthMeters: 28,
      currentNote:
        "A Gulf Stream drift, moderate to strong and usually north, at a depth where no-stop time runs short. Carry your own SMB and send it up before the ascent: Jupiter Inlet boat traffic is heavy, and the boat is looking for your marker.",
      divePlan:
        "Negative entry at the south end and drift north along the ledge. Watch east early for the sharks, and end the dive on your no-stop limit or gas, whichever comes first.",
      fitTone: "demanding",
      fitNote:
        "A deep, fast drift. Comfortable with a negative entry, an SMB, and watching your computer.",
      // Advanced Open Water for the drift and the depth near 30 m: the sand is at
      // 27 m in a strong Gulf Stream current, and it is listed as an Advanced dive.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "loggerhead-turtle",
        "hawksbill-turtle",
        "goliath-grouper",
        "atlantic-spadefish",
        "great-barracuda",
      ],
    },
  },
  // Denominator row: "Scarface"
  {
    slug: "scarface-reef-jupiter",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://www.divoceandivecharters.com/dive-sites",
      "https://divers-hub.com/SiteDetails/scarface",
    ],
    briefing: {
      name: "Scarface",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.9144,
      forecastLongitude: -80.0167,
      description:
        "A high, west-facing ledge off Jupiter named after a battle-scarred green moray that lived on it. The top is a run of shallow bowls packed with reef fish, often around sixty species on one dive.",
      marineLife: "Green morays · loggerhead turtles · nurse sharks · angelfish · spadefish",
      marineLifeDescription:
        "Tropicals in the bowls on top; turtles, nurse sharks and big morays under the ledge.",
      difficultyLevel: "intermediate",
      depthRange: "20–26 m (65–85 ft)",
      maxDepthMeters: 26,
      currentNote:
        "A Gulf Stream drift, moderate to strong and usually north. Carry your own SMB and shoot it before you leave the bottom; Jupiter Inlet boats run past all day.",
      divePlan:
        "Negative entry onto the ledge. Newer drift divers stay on top over the bowls; the rest can drop to the foot and look underneath.",
      fitTone: "welcoming",
      fitNote:
        "Easy to follow and a little shallower than Area 51, so a good drift for newer divers who stay on top.",
      creatureSlugs: [
        "green-moray",
        "loggerhead-turtle",
        "nurse-shark",
        "queen-angelfish",
        "atlantic-spadefish",
        "yellowhead-jawfish",
      ],
    },
  },
  // Denominator row: "Tunnels"
  {
    slug: "tunnels-jupiter",
    version: 1,
    area: "florida-palm-beach",
    sources: [
      "https://jupiterdivecenter.com/local-reefs/",
      "https://www.jupiterscubadiving.com/dive-sites",
      "https://www.divoceandivecharters.com/dive-sites",
      "https://divers-hub.com/SiteDetails/tunnels",
      "https://scubaboard.com/community/threads/jupiter-diving-looking-for-some-numbers.294145/",
    ],
    briefing: {
      name: "Tunnels",
      locationName: "off Jupiter, Florida",
      forecastLatitude: 26.9458,
      forecastLongitude: -80.0312,
      description:
        "A ledge just south of Jupiter Inlet with short natural swim-throughs cut through it, and big animals nearly every dive. It ends at the Donut Hole, a hollow in the reef where reef sharks rest.",
      marineLife: "Reef sharks · goliath grouper · Atlantic spadefish · southern stingrays · cobia",
      marineLifeDescription:
        "Reef sharks meet the group at the first tunnel, goliaths hang under the big undercut, and cobia shadow the stingrays in the sand.",
      difficultyLevel: "intermediate",
      depthRange: "20–23 m (65–75 ft)",
      maxDepthMeters: 26,
      currentNote:
        "A Gulf Stream drift, moderate to strong and usually north; only a strong current or nitrox gets you to the Donut Hole. Shoot your own SMB before the ascent, because the site sits off Jupiter Inlet and its boat traffic.",
      divePlan:
        "Drop a few minutes south of the first swim-through and go slowly: the sharks and goliaths are at the start. About 25 minutes in, look into the big undercut with a light, then carry on north as far as gas and no-stop time allow.",
      fitTone: "welcoming",
      fitNote:
        "Go slow and look east and west as well as at the ledge. Skip the swim-throughs if you are not comfortable under a roof.",
      landmarks: [
        {
          name: "The first tunnel",
          kind: "reefFormation",
          note: "A short, wide swim-through near the start of the drift. Goliath grouper usually wait around it.",
        },
        {
          name: "The Donut Hole",
          kind: "reefFormation",
          note: "The far north end of the site, reached only on a good current or a nitrox dive. Reef sharks, nurse sharks and goliaths shelter here.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "goliath-grouper",
        "atlantic-spadefish",
        "southern-stingray",
        "cobia",
        "nurse-shark",
      ],
    },
  },
];
