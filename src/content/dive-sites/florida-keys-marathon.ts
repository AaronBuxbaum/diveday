// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Marathon and the Middle Keys. */
export const FLORIDA_KEYS_MARATHON: DiveSiteTemplate[] = [
  {
    slug: "sombrero-reef",
    version: 1,
    area: "florida-keys-marathon",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/sombrero.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Sombrero%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://keyshistory.org/reef-lighthousespage1.html",
    ],
    briefing: {
      name: "Sombrero Reef",
      locationName: "Marathon, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.6279,
      forecastLongitude: -81.1116,
      description:
        "Marathon's signature reef, under a 43 m 1858 lighthouse. Long coral fingers with arches and swim-throughs cut into them, in water shallow enough to spend an hour in.",
      marineLife: "Parrotfish · angelfish · tarpon · nurse sharks",
      marineLifeDescription:
        "The arches hold fish out of the light all day. Look through them rather than over them.",
      difficultyLevel: "beginner",
      depthRange: "3–9 m (10–30 ft)",
      maxDepthMeters: 9,
      currentNote: "Usually mild; a sanctuary preservation area, so mooring buoys only.",
      divePlan:
        "Follow one spur out to the sand, cross the groove, and come back along the next — the arches are on the outer third.",
      fitTone: "welcoming",
      fitNote: "Shallow, structured and photogenic. One tank goes a long way at 6 m.",
      landmarks: [
        {
          name: "Sombrero Key Light",
          kind: "navigationMark",
          note: "The tallest of the Keys reef lights, standing directly over the site.",
        },
        {
          name: "The arch",
          kind: "reefFormation",
          note: "A natural coral arch big enough to swim through, on the seaward side of the reef.",
        },
      ],
      creatureSlugs: [
        "queen-parrotfish",
        "french-angelfish",
        "tarpon",
        "nurse-shark",
        "banded-butterflyfish",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "thunderbolt-wreck",
    version: 2,
    area: "florida-keys-marathon",
    sources: [
      "https://floridakeys.noaa.gov/shipwrecktrail/thunderbolt.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/ShipwreckTrail_FKNMS/FeatureServer/4/query?where=1%3D1&outFields=*&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Thunderbolt%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Thunderbolt",
      locationName: "Marathon, Florida",
      forecastLatitude: 24.6611,
      forecastLongitude: -80.9631,
      description:
        "A 57 m Army minefield tender, later used by Florida Power & Light to study lightning, sunk upright in 1986. Her big cable reel still sits on the bow. Intact, well proportioned, and the wreck most Middle Keys divers cut their teeth on.",
      marineLife: "Goliath grouper · barracuda · amberjack · black coral",
      marineLifeDescription:
        "Resident goliath grouper hold in the superstructure; the deeper steel is furred with hydroids and black coral.",
      difficultyLevel: "advanced",
      depthRange: "23–37 m (75–120 ft)",
      maxDepthMeters: 37,
      currentNote:
        "Open water on the Gulf Stream side — current is the usual reason a day is called.",
      divePlan:
        "Down the mooring to the superstructure, forward along the deck to the cable reel, and back up the line with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "Upright, tidy and deep. A very good first deep wreck for a diver with the card for it, ideally on nitrox.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The cable reel",
          kind: "wreckFeature",
          note: "A big cable drum on the bow at about 24 m. It is the picture everyone takes.",
        },
        {
          name: "Superstructure",
          kind: "wreckFeature",
          note: "The observation deck at about 23 m, usually with a grouper in residence. The aft end is cut away, so the hull lies open behind it.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "schoolmaster-snapper",
        "spotted-moray",
        "red-rope-sponge",
      ],
    },
  },
  {
    slug: "coffins-patch",
    version: 2,
    area: "florida-keys-marathon",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/coffins.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Coffins%20Patch%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.nbcnews.com/science/climate-change/florida-coral-species-declared-functionally-extinct-rcna238753",
    ],
    briefing: {
      name: "Coffins Patch",
      locationName: "Marathon, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.6803,
      forecastLongitude: -80.9583,
      description:
        "A string of shallow patch reefs inside the reef line. Each mooring sits on its own patch, so a different mooring is a different dive.",
      marineLife: "Sea fans · brain coral · butterflyfish · spiny lobster",
      marineLifeDescription:
        "Sea fans and mounding coral heads on each patch, with lobster tucked under the edges and butterflyfish in pairs over the top.",
      difficultyLevel: "beginner",
      depthRange: "3–9 m (10–30 ft)",
      maxDepthMeters: 9,
      currentNote: "Sheltered inside the reef line and usually calm.",
      divePlan:
        "One patch per dive. Circle it once wide for the shape, once close for what lives in it.",
      fitTone: "welcoming",
      fitNote: "Shallow, calm, and unhurried. A good place to practice slow, close looking.",
      landmarks: [
        {
          name: "The patch reefs",
          kind: "reefFormation",
          note: "Low coral heads rising off the bottom in shallow water. The area was once known for pillar coral, now functionally extinct on the Florida reef.",
        },
      ],
      creatureSlugs: [
        "common-sea-fan",
        "grooved-brain-coral",
        "spotfin-butterflyfish",
        "spiny-lobster",
        "smooth-trunkfish",
        "banded-coral-shrimp",
      ],
    },
  },
];
