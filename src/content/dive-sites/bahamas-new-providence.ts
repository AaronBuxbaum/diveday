// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Nassau and New Providence. */
export const BAHAMAS_NEW_PROVIDENCE: DiveSiteTemplate[] = [
  // Denominator row: James Bond Wrecks (James Bond Wreck, Tears of Allah, Vulcan bomber)
  {
    slug: "james-bond-wrecks-nassau",
    version: 1,
    area: "bahamas-new-providence",
    sources: [
      "https://www.wannadive.net/spot/Central_America/Bahamas/New_Providence_-_Nassau/The_James_Bond_Wrecks/index.html",
      "https://www.dive-the-world.com/diving-sites-bahamas-nassau.php",
      "https://web.archive.org/web/20030806083537/http://www.stuartcove.com/japan/dive/pages/divesites/west_side.html",
      "https://thescubadirectory.com/divesiteprofile/James-Bond-Wrecks-Nassau-Bahamas-Dive-Site",
    ],
    briefing: {
      name: "James Bond Wrecks",
      locationName: "Clifton Point, New Providence",
      // Approximate pin: the midpoint of two approximate listings (wannadive 25.0077, -77.5545
      // and The Scuba Directory 25.0107, -77.5571, 0.4 km apart); every source puts the wrecks
      // south or west of Clifton Point, off the south-west coast. Depth: Stuart Cove's and the
      // Scuba Directory say 12 m; wannadive's average is 14 m (it gives no maximum).
      forecastLatitude: 25.0092,
      forecastLongitude: -77.5558,
      description:
        "Two film props lying close together: the Tears of Allah, a ship of about 30 m used in Never Say Never Again, and the metal frame of the Vulcan bomber mock-up built for Thunderball. Coral and sponges now cover both, in water shallow enough for any certified diver.",
      marineLife: "Angelfish · blue parrotfish · yellowtail snapper · silversides",
      marineLifeDescription:
        "Fish school around the frames all year. In summer and fall silversides pack the hull, which is best seen from the outside.",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 15,
      currentNote:
        "No diving while a ship is alongside the pier. The wrecks lie south of Clifton Point, a working shoreline with a commercial pier, so treat it as busy water: carry an SMB and listen for engines on the way up. Current is reported as low, under 1 knot.",
      divePlan:
        "Start on the Tears of Allah, swim the short distance north to the bomber frame, and return along the same line. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "Shallow, bright and close together. One tank covers both props.",
      landmarks: [
        {
          name: "Tears of Allah",
          kind: "wreckFeature",
          note: "The film ship, in about 12 m. Stay outside the hull.",
        },
        {
          name: "Vulcan bomber frame",
          kind: "wreckFeature",
          note: "Only the metal frame of the Thunderball prop is left, a short swim north of the ship and covered in coral and sea fans.",
        },
      ],
      creatureSlugs: [
        "french-angelfish",
        "blue-parrotfish",
        "yellowtail-snapper",
        "hardhead-silverside",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Willaurie Wreck
  {
    slug: "willaurie-wreck",
    version: 1,
    area: "bahamas-new-providence",
    sources: [
      "https://www.wannadive.net/spot/Central_America/Bahamas/New_Providence_-_Nassau/The_Willaurie_Wreck/index.html",
      "https://web.archive.org/web/20030806083537/http://www.stuartcove.com/japan/dive/pages/divesites/west_side.html",
      "https://thescubadirectory.com/divesiteprofile/Willaurie-Wreck-Nassau-Bahamas-Dive-Site",
      "https://ericwiberg.com/2015/04/mv-willaurie-dutch-in-1966-then-uk-then-nassau-1980-now-a-diving-wreck-since-1988",
    ],
    briefing: {
      name: "Willaurie Wreck",
      locationName: "Clifton Point, New Providence",
      // Approximate pin: wannadive lists 25.0158, -77.5696 ("south of Goulding Cay, west of Clifton
      // Point") and The Scuba Directory 25.0154, -77.5567, 1.3 km east; a wreck history puts her
      // "southeast of Goulding Cay" (Eric Wiberg). The pin is the midpoint, 0.65 km from each
      // listing and south-east of the cay (25.0211, -77.5701). Depth: Stuart Cove's gives 15 m,
      // wannadive 15 m average and 21 m maximum.
      // Builder nationality left out: the sources do not settle Danish versus Dutch.
      forecastLatitude: 25.0156,
      forecastLongitude: -77.5632,
      description:
        "A cargo ship of about 40 m, sunk off the south-west of New Providence, with a small wooden boat from 2000 and another wreck close by. Reef has grown over all three.",
      marineLife: "Porkfish · spiny lobster · loggerhead turtles · tropical reef fish",
      marineLifeDescription:
        "Lobsters and porkfish work the hull and the reef around it, and loggerhead turtles are among the sightings.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 22,
      currentNote:
        "The wreck lies near Clifton Pier, a commercial pier, so treat it as busy water: carry an SMB and listen for engines on the way up. Usually light; it can change, so carry an SMB.",
      divePlan:
        "Drop to the deck, follow the hull to the propeller, loop through the reef around the wreck, and ascend with reserve gas. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "Mid-depth, with room to stay shallower on the reef. Night: with a guide, a primary and a backup light; no diving while a ship is alongside.",
      landmarks: [
        {
          name: "Propeller",
          kind: "wreckFeature",
          note: "The ship’s propeller, a favorite subject for photographers.",
        },
        {
          name: "Wooden boat",
          kind: "wreckFeature",
          note: "A Haitian wooden vessel that sank here in 2000, beside the cargo ship.",
        },
      ],
      creatureSlugs: [
        "porkfish",
        "spiny-lobster",
        "loggerhead-turtle",
        "trumpetfish",
        "queen-angelfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Goulding Cay
  {
    slug: "goulding-cay-nassau",
    version: 1,
    area: "bahamas-new-providence",
    sources: [
      "https://www.wannadive.net/spot/Central_America/Bahamas/New_Providence_-_Nassau/Goulding_Cay/index.html",
      "https://web.archive.org/web/20030806083537/http://www.stuartcove.com/japan/dive/pages/divesites/west_side.html",
    ],
    briefing: {
      name: "Goulding Cay",
      locationName: "Goulding Cay, New Providence",
      // Approximate pin: wannadive's reef "north of Goulding Cay" (25.0226, -77.5707), 0.2 km from
      // OpenStreetMap's point for the cay itself (25.0211, -77.5701); Stuart Cove puts the uninhabited
      // cay about 2 km off the south coast. Depth: wannadive 3 m average, 9 m maximum; Stuart Cove 6 m.
      forecastLatitude: 25.0226,
      forecastLongitude: -77.5707,
      description:
        "A broad shallow reef around an uninhabited cay, split into named stretches. Hollywood Bowl is a sand patch of about 50 m ringed with coral, used as a film set for Flipper and Splash. Elkhorn Garden has elkhorn coral growing close to the surface with snappers schooling around it.",
      marineLife: "Angelfish · snappers · southern stingrays · elkhorn coral",
      marineLifeDescription:
        "Snappers school in the elkhorn, and a large stingray turns up on the sand now and then.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 9,
      currentNote:
        "Usually light; it can change, so carry an SMB. Snorkelers share this reef, and the elkhorn grows to within reach of your fins, so stay off the bottom.",
      divePlan:
        "Start at Hollywood Bowl, follow the coral ring to Elkhorn Garden, and keep to the sand and the channels between coral heads.",
      fitTone: "welcoming",
      fitNote: "Shallow and protected, with light that carries the whole dive. A good first reef.",
      landmarks: [
        {
          name: "Hollywood Bowl",
          kind: "pointOfInterest",
          note: "A sand patch about 50 m across, ringed by coral and used in several films.",
        },
        {
          name: "Elkhorn Garden",
          kind: "reefFormation",
          note: "Elkhorn coral growing close to the surface, with snappers around it.",
        },
      ],
      creatureSlugs: [
        "elkhorn-coral",
        "french-angelfish",
        "gray-snapper",
        "southern-stingray",
        "queen-angelfish",
      ],
    },
  },
];
