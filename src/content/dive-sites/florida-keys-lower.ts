// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Lower Keys. */
export const FLORIDA_KEYS_LOWER: DiveSiteTemplate[] = [
  {
    slug: "looe-key-reef",
    version: 2,
    area: "florida-keys-lower",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/looekey.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Looe%20Key%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://dan.org/alert-diver/article/looe-key/",
      "https://en.wikipedia.org/wiki/Looe_Key",
    ],
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
      ],
    },
  },
  {
    slug: "adolphus-busch",
    version: 2,
    area: "florida-keys-lower",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Adolphus%20Busch%20Sr%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Adolphus%20Busch%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
    ],
    briefing: {
      name: "Adolphus Busch Sr.",
      locationName: "Looe Key, Florida",
      forecastLatitude: 24.53,
      forecastLongitude: -81.465,
      description:
        "A 64 m freighter sunk in 1998 and sitting upright on the sand, small enough to see properly in one dive and shallow enough at the superstructure to spend real time on.",
      marineLife: "Goliath grouper · barracuda · glassy sweepers · moray eels",
      marineLifeDescription:
        "Several very large goliath grouper live aboard. They are used to divers and entirely unbothered.",
      difficultyLevel: "advanced",
      depthRange: "20–33 m (65–110 ft)",
      maxDepthMeters: 33,
      currentNote: "Open water; current decides whether it is a line dive or a free descent.",
      divePlan:
        "Down the line to the wheelhouse at about 21 m, one lap of the exterior, and back up on gas.",
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
];
