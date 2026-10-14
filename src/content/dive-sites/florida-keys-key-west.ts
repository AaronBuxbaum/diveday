// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Key West. */
export const FLORIDA_KEYS_KEY_WEST: DiveSiteTemplate[] = [
  {
    slug: "usns-vandenberg",
    version: 2,
    area: "florida-keys-key-west",
    sources: [
      "https://visitfloridakeys.com/experiences/what-were-famous-for/diving-snorkeling/shipwrecks/vandenberg",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Hoyt%20Vandenberg%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Vandenberg%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
    ],
    briefing: {
      name: "USNS Vandenberg",
      locationName: "Key West, Florida",
      forecastLatitude: 24.4599,
      forecastLongitude: -81.7365,
      description:
        "A 159 m missile-tracking ship sunk in 2009, sitting upright in 44 m with her big tracking dishes still aboard. The second-largest artificial reef in the world, and it feels like it.",
      marineLife: "Goliath grouper · permit · barracuda · amberjack",
      marineLifeDescription:
        "Permit meet you on the way down. The superstructure carries dense schooling fish, and the dishes are usually surrounded.",
      difficultyLevel: "advanced",
      depthRange: "12–44 m (40–145 ft)",
      maxDepthMeters: 44,
      currentNote: "Seven miles offshore in open water — current is common.",
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
          note: "The tracking dishes she carried in service. They are the reason this wreck looks like nothing else.",
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
    area: "florida-keys-key-west",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/sandkey.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Sand%20Key%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://en.wikipedia.org/wiki/Sand_Key_Light",
      "https://www.islands.com/1857745/snorkeling-paradise-sand-key-lighthouse-key-west-coral-towers/",
    ],
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
    version: 2,
    area: "florida-keys-key-west",
    sources: [
      "https://myfwc.com/research/saltwater/wdr/",
      "https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-68B-6-004",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Western%20Dry%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.duikersgids.nl/en/dive-spots/western-dry-rocks",
    ],
    briefing: {
      name: "Western Dry Rocks",
      locationName: "Key West, Florida",
      forecastLatitude: 24.4467,
      forecastLongitude: -81.9283,
      description:
        "A cut-and-cave reef west of Key West, riddled with ledges and tunnels. It is a known spawning site, so the state closes it to all fishing from April through July. That is why the fish life is what it is.",
      marineLife: "Goliath grouper · permit · tarpon · nurse sharks",
      marineLifeDescription:
        "The ledges hold big fish through the day. In spring and early summer the spawning gatherings here are extraordinary.",
      difficultyLevel: "intermediate",
      depthRange: "6–20 m (20–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Tidal current runs through the cuts and can be strong, so it is often dived as a drift. Outside the spring closure the ledges carry fishing line: carry a cutter and look before you reach into a hole.",
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
];
