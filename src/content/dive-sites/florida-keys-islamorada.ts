// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Islamorada. */
export const FLORIDA_KEYS_ISLAMORADA: DiveSiteTemplate[] = [
  {
    slug: "alligator-reef",
    version: 2,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/alligator.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Alligator%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://archives.uslhs.org/places/alligator-reef",
    ],
    briefing: {
      name: "Alligator Reef",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.8472,
      forecastLongitude: -80.6197,
      description:
        "A big reef under an 1873 skeletal lighthouse, named for a US schooner wrecked here in 1822. Shallow, busy with fish, and famous for how much of it you can see at once.",
      marineLife: "Tarpon · barracuda · schooling grunts · nurse sharks",
      marineLifeDescription:
        "Enormous schools sit in the cuts between the spurs, and tarpon patrol the deeper edge in summer.",
      difficultyLevel: "beginner",
      depthRange: "3–20 m (10–65 ft)",
      maxDepthMeters: 20,
      currentNote: "Runs with the tide through the cuts — an easy drift when it does.",
      divePlan:
        "Start at the deeper sand edge, work up through a cut into the shallow coral, and finish under the boat. Some moorings sit deeper, near 20 m, so check which one the boat is on.",
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
      ],
    },
  },
  {
    slug: "eagle-wreck",
    version: 2,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/shipwrecktrail/eagle.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/ShipwreckTrail_FKNMS/FeatureServer/4/query?where=1%3D1&outFields=*&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Eagle%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Eagle Wreck",
      locationName: "Islamorada, Florida",
      forecastLatitude: 24.87,
      forecastLongitude: -80.5702,
      description:
        "An 87 m freighter sunk in 1985 and broken into two clean sections by Hurricane Georges — which made it a better dive: two open halves, both swimmable, both full of fish.",
      marineLife: "Goliath grouper · barracuda · jacks · glassy sweepers",
      marineLifeDescription:
        "The broken ends are the best of it — open, lit, and thick with schooling fish holding out of the current.",
      difficultyLevel: "advanced",
      depthRange: "21–34 m (70–110 ft)",
      maxDepthMeters: 34,
      currentNote: "Open water, and often a real current — a line dive when it is running.",
      divePlan:
        "Descend the mooring to the shallower section, work the length of one half, and turn on gas rather than on time.",
      fitTone: "demanding",
      fitNote:
        "Deep, exposed and worth nitrox. Two dives here are the best way to see the whole ship.",
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
          note: "Close to the shallowest steel, a deck railing at about 21 m. A lot of the fish life sits here.",
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
    version: 2,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/cheecarocks.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Cheeca%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://en.wikipedia.org/wiki/Cheeca_Rocks",
      "https://snorkelaroundtheworld.com/islamorada-snorkeling/",
    ],
    briefing: {
      name: "Cheeca Rocks",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.8975,
      forecastLongitude: -80.6183,
      description:
        "A patch reef inshore of the reef line, in barely 6 m of water. For years its coral held up better than most in the Keys. The 2023 heat wave hit it too, so expect it to look different from older photos. A sanctuary preservation area, and a snorkel site as much as a dive.",
      marineLife: "Brain coral · star coral · parrotfish · yellowtail snapper",
      marineLifeDescription:
        "Big mounding coral heads, and dense fish life because the structure is dense.",
      difficultyLevel: "beginner",
      depthRange: "2–6 m (6–20 ft)",
      maxDepthMeters: 6,
      currentNote: "Inshore and sheltered — the reliable call when the outer reef is unworkable.",
      divePlan:
        "A slow circuit of the patch heads; at this depth the tank outlasts anyone's patience.",
      fitTone: "welcoming",
      fitNote:
        "Barely deeper than a pool, with big coral heads close enough to study. A gentle first reef.",
      landmarks: [
        {
          name: "The mounding heads",
          kind: "reefFormation",
          note: "Boulder corals meters across, each one its own small city.",
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
];
