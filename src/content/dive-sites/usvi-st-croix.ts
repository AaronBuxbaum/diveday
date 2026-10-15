// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** St Croix. */
export const USVI_ST_CROIX: DiveSiteTemplate[] = [
  {
    slug: "salt-river-canyon-east-wall-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://www.gotostcroix.com/discover/dive-sites/salt-river-canyon-east-wall-barracuda-bank/",
      "https://web.archive.org/web/2023/https://www.nps.gov/submerged/Parks/SARI.html",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
    ],
    briefing: {
      // Approximate pin: the east side of the Salt River Canyon, just outside Salt River Bay (gotostcroix.com, NPS). The pin is about 600 m offshore of the bay mouth on the east side of the canyon, which the sources say is a quarter of a mile wide. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // A wall: the slope ends at 80 ft (24 m), then the wall drops past recreational depth. The plan floor is 24 m.
      // Gated AOW: the wall drops past the plan floor, and gotostcroix.com and the NPS name surge and current at the corner (the NPS lists strong currents for the park).
      name: "Salt River Canyon East Wall (Barracuda Bank)",
      locationName: "Salt River Bay National Historical Park, St Croix",
      forecastLatitude: 17.7885,
      forecastLongitude: -64.754,
      description:
        "The east side of the submarine canyon off Salt River Bay, a busy dive for fish on the north shore. Coral and sponge formations slope from the mooring into sand chutes, then the wall drops into deep water.",
      marineLife: "Barracuda · black durgon · blacktip sharks · turtles",
      marineLifeDescription:
        "Barracuda, big schools of black durgon and yellowtail snapper over the slope, and blacktip reef sharks off the edge of the wall.",
      conservationNote:
        "Salt River Bay is a national historical park and ecological preserve. Use the moorings provided at the East and West Walls, display a diver-down flag, and collect nothing.",
      difficultyLevel: "advanced",
      depthRange: "12–24 m (40–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Surge and current, especially where the wall turns the corner into the canyon; the NPS lists strong currents for the park. Carry an SMB.",
      divePlan:
        "Down the mooring in about 12 m, down the slope through the sand chutes to the lip at about 24 m (80 ft), and back up the coral pinnacles with reserve gas. The wall drops far past this plan.",
      fitTone: "demanding",
      fitNote: "A deep wall with surge and current at the corner. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "black-durgon",
        "yellowtail-snapper",
        "blacktip-shark",
        "green-moray",
        "spotted-eagle-ray",
      ],
    },
  },
  {
    slug: "salt-river-canyon-west-wall-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://www.gotostcroix.com/discover/dive-sites/salt-river-canyon-west-wall-grouper-grotto/",
      "https://web.archive.org/web/2023/https://www.nps.gov/submerged/Parks/SARI.html",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
    ],
    briefing: {
      // Approximate pin: the west side of the Salt River Canyon, just outside Salt River Bay (gotostcroix.com, NPS). The pin is about 600 m offshore of the bay mouth on the west side of the canyon. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // A wall: it falls almost sheer past 30 m. The plan floor is 30 m; the mooring is in about 6 m (20 ft).
      // Gated AOW: the wall drops past the plan floor, with surge and current at the corner (gotostcroix.com) and strong currents listed by the NPS.
      name: "Salt River Canyon West Wall (The Pinnacles)",
      locationName: "Salt River Bay National Historical Park, St Croix",
      forecastLatitude: 17.7885,
      forecastLongitude: -64.7585,
      description:
        "Tall pinnacles and swim-throughs, cuts, ledges and sand chutes, and a wall that drops almost sheer into the deep.",
      marineLife: "Eagle rays · groupers · barracuda · sharks",
      marineLifeDescription:
        "Rays glide around the pinnacles, creole wrasse and squirrelfish shelter under the ledges, and jacks, permit and larger sharks pass the edge.",
      conservationNote:
        "Salt River Bay is a national historical park and ecological preserve. Use the moorings provided at the East and West Walls, display a diver-down flag, and collect nothing.",
      difficultyLevel: "advanced",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Choppy at the surface, with surge and current at the corner of the wall; the NPS lists strong currents for the park. Carry an SMB. The swim-throughs and cuts among the pinnacles are overhead: stay out of them.",
      divePlan:
        "Down the mooring at about 6 m, along the pinnacles and the wall edge no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far past this plan.",
      fitTone: "demanding",
      fitNote: "A sheer wall in open water. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Pinnacles",
          kind: "reefFormation",
          note: "Coral pinnacles and ledges on the canyon’s west wall. The swim-throughs between them are overhead; stay out of them.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "black-grouper",
        "great-barracuda",
        "creole-wrasse",
        "black-durgon",
        "permit-fish",
      ],
    },
  },
  {
    slug: "the-anchors-salt-river-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://web.archive.org/web/2023/https://www.nps.gov/submerged/Parks/SARI.html",
      "https://bluesaltdivers.com/st-croix-dive-sites",
    ],
    briefing: {
      // Approximate pin: the top of the Salt River Canyon's drop-off, outside Salt River Bay (NPS, Blue Salt Divers). The pin is on the canyon's reef top midway between the two walls, about 600 m north of the bay mouth. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: the NPS gives 45 to 65 ft; Blue Salt Divers has the anchors at 45 and 55 ft, formations at 65 to 70 ft and staghorn at 75 ft (23 m), the deepest figure.
      // Gated AOW: the NPS lists strong currents for the park, Blue Salt Divers says current can occur here, and the reef sits at the edge of the drop-off.
      name: "The Anchors (Twin Anchors)",
      locationName: "Salt River Bay National Historical Park, St Croix",
      forecastLatitude: 17.787,
      forecastLongitude: -64.7562,
      description:
        "On the top of the Salt River drop-off, two big anchors from the Danish colonial period, one lying on the reef and the other on the side of a ledge overgrown with coral. The reef itself is well developed, with staghorn coral to the deeper side.",
      marineLife: "Reef sharks · parrotfish · lobsters · staghorn coral",
      marineLifeDescription:
        "Reef sharks, parrotfish and lobsters, with a field of staghorn coral past the anchors.",
      conservationNote:
        "Salt River Bay is a national historical park and ecological preserve. Leave the anchors where they lie, and collect nothing.",
      difficultyLevel: "intermediate",
      depthRange: "14–23 m (45–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Current can occur here, and the NPS lists strong currents for the park. Open water at the edge of the canyon: carry an SMB.",
      divePlan:
        "Moor on the reef top, visit the anchors at about 14 m and 17 m, cross to the staghorn coral at about 23 m, and stay on the reef. The drop-off beyond is not part of the plan.",
      fitTone: "demanding",
      fitNote:
        "A history dive on a good reef, with occasional current and the drop-off close by. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The anchors",
          kind: "pointOfInterest",
          note: "Two anchors from the Danish colonial period, one on the reef at about 14 m and the other at about 17 m on a ledge.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "queen-parrotfish",
        "spiny-lobster",
        "staghorn-coral",
        "french-grunt",
        "green-moray",
      ],
    },
  },
  {
    slug: "cane-bay-wall-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://www.gotostcroix.com/discover/dive-sites/cane-bay-wall/",
      "https://www.sweetbottomdive.com/diving",
      "https://bluesaltdivers.com/st-croix-dive-sites",
      "https://www.scubago.com/en/explore/divesite/cane-bay-377235",
    ],
    briefing: {
      // Position: the mooring buoy about 100 yards (90 m) off Cane Bay Beach, from the beach outline in OpenStreetMap; scubago.com's Cane Bay point (17.7744, -64.8122) agrees within 150 m.
      // A wall: it begins at about 12 m and drops thousands of meters. The plan floor is 30 m; technical caverns and the deeper wall are outside a recreational dive.
      name: "Cane Bay Wall",
      locationName: "Cane Bay, St Croix",
      forecastLatitude: 17.7735,
      forecastLongitude: -64.8112,
      description:
        "From the beach, swim out to the mooring buoy at about 8 m, follow sand chutes between coral gardens, and reach the lip of a wall that drops thousands of meters.",
      marineLife: "Reef sharks · turtles · barracuda · black coral",
      marineLifeDescription:
        "Reef sharks, stingrays and sea turtles are regular, black coral and large deep-water fish live on the wall, and nineteenth-century anchors lie along it.",
      difficultyLevel: "advanced",
      depthRange: "8–30 m (26–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Boats use the ramp beside the entry: listen for engines and fly a dive flag on the surface swim. Carry an SMB. Some surge and surface swell, especially in the shallows on the swim out to the buoy. Enter from the sand beside the boat ramp; the swim to the buoy is about 100 yards and to the wall about 200 yards. Exit the way you came, along the sand chutes to the buoy and the beach. Visibility runs from 20 to 60 ft.",
      divePlan:
        "Enter from the sand by the boat ramp, swim to the mooring, follow a sand chute to the lip of the wall at about 12 m, go no deeper than 30 m (100 ft), and return along the coral gardens. The wall drops far past this plan.",
      fitTone: "demanding",
      fitNote:
        "A wall that drops far past the plan, with a surface swim in and out. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "The lip of the wall begins at about 12 m and falls away to thousands of meters. The plan stops at 30 m.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "southern-stingray",
        "green-sea-turtle",
        "great-barracuda",
        "black-coral",
        "queen-triggerfish",
      ],
    },
  },
  {
    slug: "northstar-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://www.sweetbottomdive.com/diving",
      "https://bluesaltdivers.com/st-croix-dive-sites",
      "https://www.scubago.com/en/explore/divesite/north-star-180082",
    ],
    briefing: {
      // Position: scubago.com's North Star point (17.7686, -64.8216), in the water about 200 m off the north shore and west of Cane Bay as scubago describes it. Sweet Bottom places the entry at a roadside pull-off about a mile east of the Carambola resort, which agrees within about 1 km; the dive itself lies 75 yards offshore of the entry.
      // A wall: it begins at about 8 m, 75 yards from shore, and drops thousands of meters. The plan floor is 30 m.
      name: "Northstar",
      locationName: "Cane Bay, St Croix",
      forecastLatitude: 17.7686,
      forecastLongitude: -64.8216,
      description:
        "A shore dive on the north shore with a difficult entry and no sand channel to walk out on. The reward is a wall 75 yards from shore in 8 m of water, falling away almost vertically, with big elkhorn coral and sharks.",
      marineLife: "Reef sharks · elkhorn coral · jacks · mackerel",
      marineLifeDescription:
        "Reef sharks along the wall, large elkhorn corals in the shallows, and schools of tangs, wrasse and triggerfish.",
      difficultyLevel: "advanced",
      depthRange: "8–30 m (25–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Hard shore entry with no sand channel; surge and wave action make it worse, so go only on calm days, with booties on. Exit by the same route; if the surf has come up, do not dive.",
      divePlan:
        "Enter at the pull-off, swim out to the wall at about 8 m, along it no deeper than 30 m (100 ft), and come back the way you came. The wall drops far past this plan.",
      fitTone: "demanding",
      fitNote: "Rough shore entry and a vertical wall. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "elkhorn-coral",
        "horse-eye-jack",
        "blue-tang",
        "queen-triggerfish",
        "spotted-moray",
      ],
    },
  },
  {
    slug: "frederiksted-pier-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://www.gotostcroix.com/discover/dive-sites/frederiksted-pier/",
      "https://www.sweetbottomdive.com/diving",
      "https://bluesaltdivers.com/st-croix-dive-sites",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
      "https://www.scubago.com/en/explore/divesite/frederiksted-pier-13029",
    ],
    briefing: {
      // Position: the pier at Frederiksted (OpenStreetMap), about midway along its 1,500 ft; scubago.com's point (17.7142, -64.8847) agrees within 150 m.
      // Depth: the pilings average 25 ft, but gotostcroix.com gives 90 ft at the far end (Sweet Bottom 45 ft, PADI 50 ft); the deeper figure sets the range. Ungated: the plan holds to the shallow pilings (PADI 50 ft, Sweet Bottom 45 ft, average 25 ft); the 90 ft figure at the far end is reachable from the pilings, so the range and maxDepthMeters cover it (27 m) while the plan turns at 15 m.
      name: "Frederiksted Pier",
      locationName: "Frederiksted, St Croix",
      forecastLatitude: 17.7139,
      forecastLongitude: -64.886,
      description:
        "A shore dive under the pier at Frederiksted, with decades of sponge and coral on the pilings. A macro and night dive, where seahorses, frogfish, batfish and octopus live among the pillars, and a free-standing pair of mooring dolphins just south of the pier.",
      marineLife: "Seahorses · frogfish · octopus · barracuda",
      marineLifeDescription:
        "Seahorses, frogfish, arrow crabs and batfish among the pilings, with tarpon alongside them.",
      difficultyLevel: "intermediate",
      depthRange: "6–27 m (20–90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "No diving while a cruise ship or military vessel is docked at the pier, so check the cruise schedule first. The pier is a working dock: surface well clear of the pilings and boats and carry an SMB. Conditions are usually calm.",
      divePlan:
        "Enter as the crew briefs it and follow the shallow pilings out along the pier. The far end of the pier is 27 m (90 ft), well past this plan, so turn at 15 m (50 ft). Night: go with a guide and carry a backup light.",
      fitTone: "welcoming",
      fitNote:
        "The shallow pilings average about 7 m (25 ft) and the plan turns at 15 m (50 ft), well short of the far end at 27 m.",
      landmarks: [
        {
          name: "The Dolphins",
          kind: "pointOfInterest",
          note: "Two free-standing concrete moorings just south of the pier, covered in coral and sponge.",
        },
      ],
      creatureSlugs: [
        "longsnout-seahorse",
        "longlure-frogfish",
        "atlantic-common-octopus",
        "great-barracuda",
        "tarpon",
        "arrow-crab",
        "longnose-batfish",
      ],
    },
  },
  {
    slug: "butler-bay-shallow-wrecks-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://www.gotostcroix.com/discover/dive-sites/shallow-wrecks-at-butler-bay/",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
      "https://www.scubago.com/en/explore/divesite/shallow-wrecks-at-butler-bay-609574",
    ],
    briefing: {
      // Position: scubago.com's Shallow Wrecks point (17.7509, -64.8953) in open water; gotostcroix.com puts Butler Bay 2.7 miles north of Frederiksted, which agrees within 1 km. The shallow wrecks lie a few hundred yards south of the deep ones, and the two scubago points are 160 m apart.
      // Depth: gotostcroix.com gives Virgin Islander at 70 ft and Suffolk Maid at 60 to 80 ft; the deepest figure sets the range. Ungated: depth only, no overhead or current beyond a slight one.
      name: "Butler Bay Shallow Wrecks",
      locationName: "Butler Bay, St Croix",
      forecastLatitude: 17.7509,
      forecastLongitude: -64.8953,
      description:
        "Three wrecks in Butler Bay: the Suffolk Maid trawler, the Northwind tug and the Virgin Islander oil barge, with the Aegir underwater habitat. All are encrusted with coral and sponge, and schools of reef fish swarm them.",
      marineLife: "Barracuda · snapper · moray eels · turtles",
      marineLifeDescription:
        "Barracuda, snapper and angelfish around the wrecks, large groupers and stingrays beside the barge, and green and hawksbill turtles near the Northwind.",
      difficultyLevel: "intermediate",
      depthRange: "5–24 m (15–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "A slight current is to be expected. Dive from a boat; do not swim out from shore. The Aegir habitat is overhead; stay outside.",
      divePlan:
        "Dive the wrecks from a boat. The Northwind’s wheelhouse is the shallow top; the barge is the deepest. Stay outside the hull of each wreck.",
      fitTone: "welcoming",
      fitNote:
        "Wrecks from 5 m to 24 m. The Northwind is the shallow one; the Suffolk Maid and the barge reach 21 to 24 m (70 to 80 ft).",
      landmarks: [
        {
          name: "Northwind",
          kind: "wreckFeature",
          note: "A 75 ft tug in 55 ft of water with the wheelhouse top about 15 ft below the surface. Stay outside the hull.",
        },
        {
          name: "Virgin Islander",
          kind: "wreckFeature",
          note: "A 300 ft oil barge, the largest of the three, with its deepest part at about 70 ft. Stay outside the hull.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "yellowtail-snapper",
        "green-moray",
        "hawksbill-turtle",
        "goliath-grouper",
        "southern-stingray",
      ],
    },
  },
  {
    slug: "butler-bay-deep-wrecks-st-croix",
    version: 1,
    area: "usvi-st-croix",
    sources: [
      "https://www.gotostcroix.com/discover/dive-sites/deep-wrecks-at-butler-bay/",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
      "https://www.scubago.com/en/explore/divesite/deep-wrecks-at-bulter-bay-608549",
    ],
    briefing: {
      // Position: scubago.com's Deep Wrecks point (17.7523, -64.8951) in open water; gotostcroix.com puts Butler Bay 2.7 miles north of Frederiksted, which agrees within 1 km. The deep wrecks lie a few hundred yards north of the shallow ones.
      // Gated AOW + Deep: the Rosaomaira's deepest point is about 117 ft (36 m) per gotostcroix.com; PADI gives 110 ft (34 m), and the deeper figure is used.
      name: "Butler Bay Deep Wrecks",
      locationName: "Butler Bay, St Croix",
      forecastLatitude: 17.7523,
      forecastLongitude: -64.8951,
      description:
        "Two wrecks in Butler Bay: the Rosaomaira, a Venezuelan freighter that sits upright, and the Coakley Bay, a refinery tug. Both are encrusted with live coral and sponges.",
      marineLife: "Seahorses · soldierfish · snapper · stingrays",
      marineLifeDescription:
        "A shy seahorse often hides on the back of the Rosaomaira, blackbar soldierfish and mahogany snapper are regular, and southern stingrays rest on the sand around the hulls.",
      difficultyLevel: "advanced",
      depthRange: "9–36 m (30–117 ft)",
      maxDepthMeters: 36,
      currentNote:
        "Generally little or no current and calm seas inside the bay, but the surface swim from shore is long and strenuous, so go by boat.",
      divePlan:
        "Down the line to the Rosaomaira’s bow at about 21 m, along the outside of the hull toward the propeller at about 34 m, and no deeper than 36 m (117 ft). Finish on the Coakley Bay, whose tower rises to about 9 m. Stay outside the hull of each wreck.",
      fitTone: "demanding",
      fitNote: "A deep wreck with depth to 36 m. Advanced Open Water and Deep.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Rosaomaira",
          kind: "wreckFeature",
          note: "A 177 ft freighter sitting upright, with the bow at about 21 m and the propeller at about 34 m. Stay outside the hull.",
        },
        {
          name: "Coakley Bay",
          kind: "wreckFeature",
          note: "A refinery tug at about 18 m with her tower reaching up to about 9 m. Stay outside the hull.",
        },
      ],
      creatureSlugs: [
        "longsnout-seahorse",
        "blackbar-soldierfish",
        "mahogany-snapper",
        "southern-stingray",
        "french-angelfish",
        "atlantic-spadefish",
      ],
    },
  },
];
