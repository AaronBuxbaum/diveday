// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** The Panhandle and the Gulf. */
export const FLORIDA_GULF: DiveSiteTemplate[] = [
  {
    slug: "uss-oriskany",
    version: 2,
    area: "florida-gulf",
    sources: [
      "https://myfwc.com/fishing/saltwater/artificial-reefs/oriskany/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Oriskany%20Memorial%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://reefsmartguides.com/oriskany/",
    ],
    briefing: {
      name: "USS Oriskany",
      locationName: "Pensacola, Florida",
      forecastLatitude: 30.0425,
      forecastLongitude: -87.0064,
      description:
        "An aircraft carrier, 278 m (911 ft) long, sunk in 2006 and standing upright in 65 m of Gulf water. The largest artificial reef in the world. A recreational plan stays on the island tower, from about 26 m; the flight deck at 44–46 m and the sand at 65 m are technical dives.",
      marineLife: "Amberjack · barracuda · red snapper · whale sharks (rarely)",
      marineLifeDescription:
        "Pelagic. The tower holds bait balls and the amberjack that work them; the open Gulf brings everything else.",
      difficultyLevel: "advanced",
      depthRange: "26–44 m (85–145 ft)",
      maxDepthMeters: 44,
      currentNote:
        "Open Gulf, 22 miles out. Current, visibility and the boat ride all decide the day together.",
      divePlan:
        "The island tower only, on a recreational dive: down the line to about 26–30 m, one section of the superstructure, and back up the line. The flight deck is a technical dive.",
      fitTone: "demanding",
      fitNote:
        "This is the deepest thing most recreational divers will ever do, on a long open-Gulf ride. Nitrox, a conservative plan, and a hard turn pressure.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The island tower",
          kind: "wreckFeature",
          note: "The superstructure, from about 26 m down. The whole recreational dive happens here.",
        },
        {
          name: "The flight deck",
          kind: "wreckFeature",
          note: "At about 44–46 m and beyond recreational limits for most plans. Look down at it, not from it.",
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
    version: 2,
    area: "florida-gulf",
    sources: [
      "https://en.wikipedia.org/wiki/Vamar_Shipwreck_Site",
      "https://npgallery.nps.gov/GetAsset/54d835f5-7714-4d33-81e4-80f4e5d8a557",
    ],
    briefing: {
      name: "Vamar Wreck",
      locationName: "Mexico Beach, Florida",
      forecastLatitude: 29.8989,
      forecastLongitude: -85.4633,
      description:
        "A 52 m steamer that carried Admiral Byrd's 1928 Antarctic expedition. She sank in 1942 about 6 km off Mexico Beach with a load of lumber, and is now a protected state underwater archaeological preserve in 8 m of sand.",
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
        "sand-diver",
        "gray-snapper",
        "spotted-scorpionfish",
      ],
    },
  },
];
